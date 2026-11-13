'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { redactSecrets, distillSessionChunk, upsertTypedNodes } = require('./session-capture.cjs');
const { makeChunkId } = require('./chunk-split.cjs');
const {
  createMemoryService,
  writeIngestChunkToDb,
} = require('./memory-service.cjs');
const { buildIngestProvenance } = require('./provenance.cjs');
const { mapLegacyWorkId } = require('./taxonomy.cjs');

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
  const windsurfUser = partsToText(obj.user_input?.user_response);
  if (windsurfUser.trim()) return windsurfUser;
  const windsurfPlanner = partsToText(obj.planner_response?.response);
  if (windsurfPlanner.trim()) return windsurfPlanner;
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
      const role =
        obj.role ||
        obj.type ||
        (obj.user_input ? 'user' : null) ||
        (obj.planner_response ? 'assistant' : null) ||
        'unknown';
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
 * Insert session chunk into chunks table (provenance required — ADR-012 / AE-030h1).
 * @param {*} db
 * @param {{
 *   sessionId: string,
 *   turnIdx: number,
 *   role: string,
 *   body: string,
 *   sourcePath?: string,
 *   ingestedAt?: string,
 * }} row
 */
function insertSessionChunk(db, row) {
  const body = redactSecrets(String(row.body || '')).redacted;
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  const relPath = `.agentic-swe/sessions/${row.sessionId}.md`;
  const chunkId = makeChunkId(relPath, row.turnIdx, row.turnIdx, sha);
  const workId = `session:${row.sessionId}`;
  const scope = mapLegacyWorkId(workId);
  const originRef = row.sourcePath
    ? String(row.sourcePath)
    : `session:${row.sessionId}:turn:${row.turnIdx}`;
  const provenance = buildIngestProvenance({
    source: 'session-ingest',
    originPathOrEvent: originRef,
    actor: 'system:session-ingest',
    sourceHash: sha,
    ingestedAt: row.ingestedAt || new Date().toISOString(),
  });
  writeIngestChunkToDb(db, {
    chunkId,
    path: relPath,
    workId,
    scope,
    body,
    startLine: row.turnIdx,
    endLine: row.turnIdx,
    contentSha256: sha,
    recordJson: JSON.stringify({
      id: chunkId,
      scope,
      provenance,
      trust: 'untrusted',
      redaction: { applied: true, ruleset: 'redact.cjs', hits: 0 },
      role: row.role != null ? String(row.role) : undefined,
    }),
  });
}

/**
 * Ingest transcript files into memory sqlite.
 * @param {{ projectRoot: string, pluginRoot: string, transcriptPaths: string[], maxFiles?: number }} opts
 */
async function ingestTranscripts(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);

  const files = (opts.transcriptPaths || []).slice(0, opts.maxFiles || 50);
  let nodes = 0;
  let chunks = 0;
  let redactionHits = 0;
  let blocked = 0;
  let sqlitePath = null;

  const svc = createMemoryService({ pluginRoot, projectRoot });
  const ingestedAt = new Date().toISOString();
  try {
    await svc.withProjectDb(async (db, ctx) => {
      sqlitePath = ctx.sqlitePath;
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
          insertSessionChunk(db, {
            sessionId,
            turnIdx: i + 1,
            role: t.role,
            body: redacted.slice(0, 8000),
            sourcePath: file,
            ingestedAt,
          });
          chunks++;
          const distilled = distillSessionChunk({
            text: redacted,
            workId: `session:${sessionId}`,
            source: file,
          });
          if (!distilled.blocked && distilled.nodes.length) {
            const distilledWithProv = distilled.nodes.map((n) => ({
              ...n,
              provenance: buildIngestProvenance({
                source: 'session-ingest',
                originPathOrEvent: `${file}#turn:${i + 1}#${n.id}`,
                actor: 'system:session-ingest',
                sourceHash: crypto
                  .createHash('sha256')
                  .update(String(n.body || n.id))
                  .digest('hex'),
                ingestedAt,
              }),
            }));
            upsertTypedNodes(db, distilledWithProv);
            nodes += distilled.nodes.length;
          }
        }
        const sessionBody = `Ingested ${turns.length} turns from ${file}`;
        const sessionNode = {
          id: `session:${sessionId}`,
          kind: 'session',
          label: path.basename(file),
          body: sessionBody,
          provenance: buildIngestProvenance({
            source: 'session-ingest',
            originPathOrEvent: file,
            actor: 'system:session-ingest',
            sourceHash: crypto.createHash('sha256').update(sessionBody).digest('hex'),
            ingestedAt,
          }),
        };
        upsertTypedNodes(db, [sessionNode]);
        nodes++;
      }
      await ctx.store.persist();
    });
  } finally {
    await svc.close();
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
