'use strict';

const fs = require('node:fs');

/**
 * @param {unknown} content
 * @returns {string}
 */
function contentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
      else if (typeof block.text === 'string') parts.push(block.text);
    }
    return parts.join('\n');
  }
  return String(content);
}

/**
 * @param {object} obj one JSONL object
 * @returns {{ role: string, text: string, ts: string|null } | null}
 */
function turnFromLine(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const t = obj.type;
  const msg = obj.message && typeof obj.message === 'object' ? obj.message : obj;
  const role = msg.role || (t === 'user' ? 'user' : t === 'assistant' ? 'assistant' : null);
  if (role !== 'user' && role !== 'assistant') return null;
  const text = contentToText(msg.content != null ? msg.content : obj.content);
  if (!text.trim()) return null;
  const ts = obj.timestamp || msg.timestamp || null;
  return { role, text: text.trim(), ts: ts ? String(ts) : null };
}

/**
 * @param {string} transcriptPath absolute
 * @returns {Array<{ role: string, text: string, ts: string|null }>}
 */
function parseTranscriptTurns(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    const turn = turnFromLine(obj);
    if (turn) out.push(turn);
  }
  return out;
}

/**
 * @param {string} oldBlock
 * @param {{ provider?: string, model?: string }} opts
 */
async function summarizeWithOpenAI(oldBlock, opts) {
  const key = process.env.OPENAI_API_KEY || process.env.AGENTIC_SWE_OPENAI_API_KEY;
  if (!key) {
    throw new Error('OPENAI_API_KEY or AGENTIC_SWE_OPENAI_API_KEY required for LLM sliding summary');
  }
  const model =
    opts.model ||
    process.env.AGENTIC_SWE_SLIDING_SUMMARY_MODEL ||
    'gpt-4o-mini';
  const url = process.env.AGENTIC_SWE_OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Summarize the following older conversation turns into 3–10 short bullet points. Preserve file paths, commands, and decisions. Omit filler.',
      },
      { role: 'user', content: oldBlock.slice(0, 120000) },
    ],
    max_tokens: 1200,
    temperature: 0.2,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const tx = await res.text();
    throw new Error(`OpenAI sliding summary HTTP ${res.status}: ${tx.slice(0, 300)}`);
  }
  const data = await res.json();
  const txt = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return String(txt || '').trim();
}

/**
 * @param {Array<{ role: string, text: string, ts: string|null }>} turns
 * @param {{ recentVerbatim: number, maxOldChars: number, useLlm?: boolean, llmModel?: string }} opts
 */
async function buildSlidingSummaryMarkdown(turns, opts) {
  const recentN = Math.max(1, Math.min(100, Number(opts.recentVerbatim) || 8));
  const maxOld = Math.max(80, Math.min(2000, Number(opts.maxOldChars) || 240));
  const lines = [];
  lines.push('# Sliding summary (transcript)');
  lines.push('');
  lines.push(
    '_Advisory: reconcile with `state.json` and artifacts. Older turns may be truncated or LLM-summarized._'
  );
  lines.push('');

  if (turns.length === 0) {
    lines.push('_No user/assistant turns found in transcript._');
    return lines.join('\n');
  }

  const old = turns.slice(0, Math.max(0, turns.length - recentN));
  const recent = turns.slice(-recentN);

  if (old.length) {
    lines.push('## Earlier turns (compressed)');
    lines.push('');
    if (opts.useLlm) {
      const block = old.map((t, i) => `[${i + 1}] ${t.role}: ${t.text}`).join('\n\n');
      try {
        const sum = await summarizeWithOpenAI(block, { model: opts.llmModel });
        lines.push(sum);
      } catch (e) {
        lines.push(`_LLM summary failed: ${e && e.message ? e.message : String(e)}_`);
        lines.push('');
        for (let i = 0; i < old.length; i++) {
          const t = old[i];
          const snip = t.text.length > maxOld ? `${t.text.slice(0, maxOld)}…` : t.text;
          lines.push(`- **${t.role}:** ${snip.replace(/\s+/g, ' ')}`);
        }
      }
    } else {
      for (let i = 0; i < old.length; i++) {
        const t = old[i];
        const snip = t.text.length > maxOld ? `${t.text.slice(0, maxOld)}…` : t.text;
        lines.push(`- **${t.role}:** ${snip.replace(/\s+/g, ' ')}`);
      }
    }
    lines.push('');
  }

  lines.push('## Recent turns (verbatim)');
  lines.push('');
  for (const t of recent) {
    lines.push(`### ${t.role}${t.ts ? ` _(${t.ts})_` : ''}`);
    lines.push('');
    lines.push(t.text);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  parseTranscriptTurns,
  buildSlidingSummaryMarkdown,
  contentToText,
  summarizeWithOpenAI,
};
