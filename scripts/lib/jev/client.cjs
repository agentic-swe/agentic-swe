'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadJevConfig } = require('./config.cjs');

const SILENT_REASONS = new Set(['disabled', 'missing_key']);

function capState(text, max) {
  const s = String(text ?? '');
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : s.length;
  if (s.length <= limit) return s;
  return s.slice(0, limit);
}

function usageOf(body) {
  const usage = body && body.usage;
  return {
    input_tokens: usage && Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : 0,
    output_tokens: usage && Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : 0,
  };
}

function validateAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object') return false;
  for (const [key, question] of Object.entries(questions)) {
    const answer = answers[key];
    if (!answer || answer.type !== question.type) return false;
    if (question.type === 'choice') {
      const criteria = question.criteria || {};
      if (typeof answer.choice !== 'string' || !Object.prototype.hasOwnProperty.call(criteria, answer.choice)) {
        return false;
      }
      if (typeof answer.confidence !== 'number' || answer.confidence < 0 || answer.confidence > 1) return false;
      if (!answer.probabilities || typeof answer.probabilities !== 'object') return false;
    } else if (question.type === 'noul') {
      if (typeof answer.noul !== 'number' || answer.noul < 0 || answer.noul > 1) return false;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Append one bounded audit line. Never writes credentials or response bodies.
 * @param {string} workDir
 * @param {{ seam: string, model?: string|null, reason: string, usage?: { input_tokens?: number, output_tokens?: number }|null }} entry
 */
function appendJevAudit(workDir, entry) {
  if (!workDir || !entry || !entry.seam || !entry.reason) return;
  const dir = path.resolve(workDir);
  if (!fs.existsSync(dir)) return;
  const input = entry.usage && Number.isFinite(entry.usage.input_tokens) ? entry.usage.input_tokens : 0;
  const output = entry.usage && Number.isFinite(entry.usage.output_tokens) ? entry.usage.output_tokens : 0;
  const model = entry.model || 'none';
  const line = `${new Date().toISOString()} actor=jev action=${entry.seam} | evidence: model=${model} reason=${entry.reason} input_tokens=${input} output_tokens=${output}\n`;
  fs.appendFileSync(path.join(dir, 'audit.log'), line);
}

function shouldRecordAudit(reason, opts) {
  if (!opts || !opts.workDir || opts.audit === false) return false;
  if (SILENT_REASONS.has(reason) && opts.auditSkips !== true) return false;
  return true;
}

function noteOutcome(result, opts) {
  const reason = result.skipped ? result.reason : 'ok';
  if (shouldRecordAudit(reason, opts)) {
    appendJevAudit(opts.workDir, {
      seam: opts.seam || 'classify',
      model: result.model,
      reason,
      usage: result.usage,
    });
  }
  return result;
}

function skipped(reason, model) {
  return { skipped: true, reason, model: model || null, answers: null, usage: null };
}

/**
 * @param {{
 *   pluginRoot: string,
 *   projectRoot?: string,
 *   state: string,
 *   questions: object,
 *   stateCap?: number,
 *   seam?: string,
 *   workDir?: string,
 *   fetchImpl?: typeof fetch,
 *   env?: NodeJS.ProcessEnv,
 *   config?: object,
 *   audit?: boolean,
 *   auditSkips?: boolean,
 * }} opts
 */
async function classify(opts) {
  const env = opts.env || process.env;
  const config = opts.config || loadJevConfig(opts.pluginRoot, opts.projectRoot, env);
  const model = config.model;
  if (!config.enabled) return noteOutcome(skipped('disabled', model), opts);
  const key = env.TYPESAFE_API_KEY;
  if (!key) return noteOutcome(skipped('missing_key', model), opts);

  const questions = opts.questions;
  if (!questions || typeof questions !== 'object' || Object.keys(questions).length === 0) {
    return noteOutcome(skipped('invalid_response', model), opts);
  }

  const cap = opts.stateCap != null ? opts.stateCap : config.state_cap.routing;
  const controller = new AbortController();
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  let timer;
  try {
    const res = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error('timeout');
        err.name = 'AbortError';
        reject(err);
      }, config.timeout_ms);
      Promise.resolve()
        .then(() =>
          fetchImpl(config.endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              state: capState(opts.state, cap),
              questions,
            }),
            signal: controller.signal,
          })
        )
        .then(
          (value) => resolve(value),
          (err) => reject(err)
        );
    });
    if (!res || res.ok !== true) return noteOutcome(skipped('http_error', model), opts);
    let body;
    try {
      body = await res.json();
    } catch {
      return noteOutcome(skipped('invalid_response', model), opts);
    }
    if (!validateAnswers(questions, body && body.answers)) {
      return noteOutcome(skipped('invalid_response', model), opts);
    }
    const resolved = body && typeof body.model === 'string' ? body.model : model;
    return noteOutcome(
      {
        skipped: false,
        reason: null,
        model: resolved,
        answers: body.answers,
        usage: usageOf(body),
      },
      opts
    );
  } catch (err) {
    const aborted = controller.signal.aborted || (err && (err.name === 'AbortError' || err.name === 'TimeoutError'));
    return noteOutcome(skipped(aborted ? 'timeout' : 'http_error', model), opts);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  SILENT_REASONS,
  capState,
  validateAnswers,
  appendJevAudit,
  classify,
};
