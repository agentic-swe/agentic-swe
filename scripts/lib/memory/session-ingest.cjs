'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { redactSecrets, distillSessionChunk, upsertTypedNodes } = require('./session-capture.cjs');
const { makeChunkId } = require('./chunk-split.cjs');

/**
 * Compact one Cursor/Claude tool_use part for memory (no file bodies, no secrets-heavy dumps).
 * @param {object} p
 * @returns {string}
 */
function toolUseToTraceLine(p) {
  if (!p || typeof p !== 'object') return '';
  const typ = String(p.type || '');
  const name = String(p.name || p.tool || '');
  if (typ && typ !== 'tool_use' && typ !== 'toolCall' && typ !== 'functionCall') return '';
  if (!name) return '';
  const inp = p.input || p.parameters || p.arguments || {};
  const cmd = typeof inp.command === 'string' ? inp.command.replace(/\s+/g, ' ').trim().slice(0, 180) : '';
  const filePath = String(inp.path || inp.file_path || inp.target_file || '').slice(0, 240);
  if (/^(Read|read_file)$/i.test(name) && filePath) return `[tool Read ${filePath}]`;
  if (/^(Shell|Bash)$/i.test(name) && cmd) return `[tool Shell ${cmd}]`;
  if (/^Grep$/i.test(name)) return `[tool Grep ${String(inp.pattern || '').slice(0, 80)} ${filePath}]`.trim();
  if (/^Glob$/i.test(name)) return `[tool Glob ${String(inp.pattern || inp.glob_pattern || '').slice(0, 80)}]`;
  if (/^(Write|StrReplace|Edit)$/i.test(name) && filePath) return `[tool ${name} ${filePath}]`;
  return `[tool ${name}]`;
}

/**
 * Extract plain text from Cursor/Claude JSONL line.
 * @param {object|Array|string} parts
 * @returns {string}
 */
function partsToText(parts) {
  if (!parts) return '';
  if (typeof parts === 'string') return parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => {
      if (!p) return '';
      if (typeof p === 'string') return p;
      const toolLine = toolUseToTraceLine(p);
      if (toolLine) return toolLine;
      if (p.type === 'text' && p.text) return p.text;
      if (typeof p.text === 'string') return p.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function textFromJsonlLine(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const fromMessage = partsToText(obj.message?.content);
  if (fromMessage.trim()) return fromMessage;
  const fromContent = partsToText(obj.content);
  if (fromContent.trim()) return fromContent;
  if (typeof obj.text === 'string') return obj.text;
  return '';
}

/**
 * Parse a JSONL transcript file into turn texts.
 * @param {string} filePath
 * @param {number} maxLines
 * @returns {{ sessionId: string, turns: Array<{ role: string, text: string }> }}
 */
function parseTranscriptFile(filePath, maxLines = 500) {
  const sessionId = path.basename(filePath, '.jsonl');
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').slice(0, maxLines);
  /** @type {Array<{ role: string, text: string }>} */
  const turns = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const role = obj.role || obj.type || 'unknown';
      const text = textFromJsonlLine(obj);
      if (text.trim().length < 12) continue;
      turns.push({ role: String(role), text });
    } catch {
      /* skip malformed */
    }
  }
  return { sessionId, turns };
}

/**
 * Walk directory for .jsonl transcript files.
 * @param {string} dir
 * @returns {string[]}
 */
function findJsonlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(abs);
      else if (ent.name.endsWith('.jsonl')) out.push(abs);
    }
  }
  return out.sort();
}

/**
 * Insert session chunk into chunks table.
 * @param {*} db
 * @param {{ sessionId: string, turnIdx: number, role: string, body: string }} row
 */
function insertSessionChunk(db, row) {
  const chunkId = makeChunkId(
    `.agentic-swe/sessions/${row.sessionId}.md`,
    row.turnIdx,
    row.turnIdx,
    crypto.createHash('sha256').update(row.body).digest('hex')
  );
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO chunks (chunk_id, path, work_id, start_line, end_line, content_sha256, body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run([
    chunkId,
    `.agentic-swe/sessions/${row.sessionId}.md`,
    `session:${row.sessionId}`,
    row.turnIdx,
    row.turnIdx,
    crypto.createHash('sha256').update(row.body).digest('hex'),
    row.body,
  ]);
  stmt.free();
}

/**
 * Ingest transcript files into memory sqlite.
 * @param {{ projectRoot: string, pluginRoot: string, transcriptPaths: string[], maxFiles?: number }} opts
 */
async function ingestTranscripts(opts) {
  const { openOrCreateDatabase, persistDatabase, closeDatabase, ensureChunksSchema } = require('./graph-store.cjs');
  const { loadMergedMemoryConfig, sqlitePathForProject } = require('./config.cjs');

  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);

  const files = (opts.transcriptPaths || []).slice(0, opts.maxFiles || 50);
  let nodes = 0;
  let chunks = 0;
  let redactionHits = 0;
  let blocked = 0;

  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    ensureChunksSchema(db);
    for (const file of files) {
      const { sessionId, turns } = parseTranscriptFile(file);
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        const { redacted, hits } = redactSecrets(t.text);
        redactionHits += hits;
        if (hits > 0 && redacted.trim().length < 40) {
          blocked++;
          continue;
        }
        insertSessionChunk(db, { sessionId, turnIdx: i + 1, role: t.role, body: redacted.slice(0, 8000) });
        chunks++;
        const distilled = distillSessionChunk({
          text: redacted,
          workId: `session:${sessionId}`,
          source: file,
        });
        if (!distilled.blocked && distilled.nodes.length) {
          upsertTypedNodes(db, distilled.nodes);
          nodes += distilled.nodes.length;
        }
      }
      const sessionNode = {
        id: `session:${sessionId}`,
        kind: 'session',
        label: path.basename(file),
        body: `Ingested ${turns.length} turns from ${file}`,
      };
      upsertTypedNodes(db, [sessionNode]);
      nodes++;
    }
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }

  return { ok: true, sqlitePath, files: files.length, chunks, nodes, redactionHits, blocked };
}

module.exports = {
  textFromJsonlLine,
  parseTranscriptFile,
  findJsonlFiles,
  insertSessionChunk,
  ingestTranscripts,
  toolUseToTraceLine,
  partsToText,
};
