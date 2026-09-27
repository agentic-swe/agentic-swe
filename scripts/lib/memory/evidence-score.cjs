'use strict';

const { isWellFormedCommand } = require('../descent/procedure-hygiene.cjs');

const DECISION_RE = /(?:decided|decision|chosen|we will)\s*[:\-]\s*(\S.{19,200})/i;
const LESSON_RE = /(?:lesson|learned|takeaway)\s*[:\-]\s*(\S.{19,200})/i;
const COMMAND_RE = /\b((?:npm|pnpm|yarn|npx|node|bash)\s+[^\n]{2,160})/g;
const PATH_RE = /\b(?:src|scripts|test|skills|hooks|docs|phases|config|bench)\/[\w./-]{2,120}\.[a-zA-Z0-9]{1,10}\b/;
const OUTCOME_RE = /\b(passed|failed|verified|because|exit code|reproduced)\b/i;

function clamp(score) {
  return Math.max(0, Math.min(1, score));
}

function extractCommands(text) {
  const found = [];
  COMMAND_RE.lastIndex = 0;
  let match;
  while ((match = COMMAND_RE.exec(text)) !== null) {
    let raw = match[1].trim().replace(/\s+/g, ' ');
    const sentence = raw.search(/[.!?](?:\s|$)/);
    if (sentence > 0 && !/\.(?:js|cjs|mjs|sh|json)$/.test(raw.slice(0, sentence))) {
      raw = raw.slice(0, sentence);
    }
    raw = raw.replace(/[.!?]+$/, '');
    if (raw) found.push(raw);
  }
  return found;
}

/**
 * Score a transcript chunk by converging evidence, not a single keyword.
 * @param {string} text
 */
function scoreCapture(text) {
  const body = String(text || '');
  const evidence = [];
  let score = 0;
  const decision = body.match(DECISION_RE);
  const lesson = body.match(LESSON_RE);
  if (decision) {
    score += 0.55;
    evidence.push('decision-act');
  }
  if (lesson) {
    score += 0.55;
    evidence.push('lesson-act');
  }
  const commands = extractCommands(body);
  const wellFormed = commands.filter((cmd) => isWellFormedCommand(cmd));
  const malformed = commands.filter((cmd) => !isWellFormedCommand(cmd));
  if (wellFormed.length) {
    score += 0.3;
    evidence.push('runnable-command');
  }
  if (malformed.length) {
    score -= 0.5;
    evidence.push('malformed-command');
  }
  if (PATH_RE.test(body)) {
    score += 0.15;
    evidence.push('repo-path');
  }
  if (OUTCOME_RE.test(body)) {
    score += 0.15;
    evidence.push('outcome');
  }
  return {
    score: clamp(score),
    evidence,
    decision: decision ? decision[1].trim() : null,
    lesson: lesson ? lesson[1].trim() : null,
    commands: wellFormed,
  };
}

/**
 * Generic transcript text becomes a pattern only with concrete evidence.
 * Keyword hits alone are not enough, and prose commands are rejected.
 * @param {ReturnType<typeof scoreCapture>} scored
 */
function acceptsPattern(scored) {
  if (!scored || scored.score < 0.45) return false;
  if (scored.evidence.includes('malformed-command') && !scored.evidence.includes('runnable-command')) return false;
  return scored.evidence.includes('runnable-command')
    && (scored.evidence.includes('repo-path') || scored.evidence.includes('outcome'));
}

module.exports = {
  scoreCapture,
  acceptsPattern,
};
