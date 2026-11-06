'use strict';

/**
 * @typedef {'stop'|'length'|'tool_calls'|'error'} FinishReason
 *
 * @typedef {{
 *   tools: boolean,
 *   json_schema: boolean,
 *   vision: boolean,
 *   context_tokens: number,
 *   streaming: boolean,
 * }} Capabilities
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   arguments: object,
 * }} ToolCall
 *
 * @typedef {{
 *   role: string,
 *   content: string|object|Array,
 * }} Msg
 *
 * @typedef {{
 *   input: number|null,
 *   output: number|null,
 *   cache_read?: number|null,
 *   usage_source: 'provider'|'absent',
 *   usd: number|null,
 *   cost_source: 'local'|'price_table'|'provider'|'unknown',
 *   latency_ms: number,
 *   provider: string,
 *   model: string,
 * }} Usage
 *
 * @typedef {{
 *   content: string|null,
 *   tool_calls: ToolCall[],
 *   finish_reason: FinishReason,
 *   usage: Usage,
 *   model: string,
 *   provider: string,
 *   raw?: object,
 *   fallback_from?: string|null,
 * }} ModelResponse
 */

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const NEVER_RETRY_STATUS = new Set([400, 401, 403]);

class GatewayError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ retryable?: boolean, status?: number, capability?: string, cause?: unknown, details?: object }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.retryable = Boolean(opts.retryable);
    if (opts.status != null) this.status = opts.status;
    if (opts.capability) this.capability = opts.capability;
    if (opts.cause !== undefined) this.cause = opts.cause;
    if (opts.details) this.details = opts.details;
  }
}

/**
 * @param {number|undefined|null} status
 * @returns {boolean}
 */
function isRetryableStatus(status) {
  if (status == null) return false;
  const n = Number(status);
  if (NEVER_RETRY_STATUS.has(n)) return false;
  if (RETRYABLE_STATUS.has(n)) return true;
  return n >= 500 && n < 600;
}

/**
 * @param {number|undefined|null} status
 * @param {string} [message]
 * @param {object} [extra]
 * @returns {GatewayError}
 */
function errorFromStatus(status, message, extra = {}) {
  const n = status == null ? undefined : Number(status);
  const retryable = isRetryableStatus(n);
  const code =
    n === 429
      ? 'RATE_LIMITED'
      : n != null && n >= 500
        ? 'PROVIDER_ERROR'
        : n === 401 || n === 403
          ? 'AUTH_ERROR'
          : n === 400
            ? 'BAD_REQUEST'
            : 'PROVIDER_ERROR';
  return new GatewayError(code, message || `provider status ${n}`, {
    retryable,
    status: n,
    ...extra,
  });
}

/**
 * @param {unknown} err
 * @returns {GatewayError}
 */
function asGatewayError(err) {
  if (err instanceof GatewayError) return err;
  if (err && typeof err === 'object' && /** @type {any} */ (err).name === 'AbortError') {
    return new GatewayError('TIMEOUT', 'request aborted', { retryable: false, status: undefined });
  }
  const msg = err && typeof err === 'object' && 'message' in err ? String(/** @type {any} */ (err).message) : String(err);
  // Network-ish failures are retryable; never treat auth-looking messages as retryable here.
  const retryable = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|socket/i.test(msg);
  return new GatewayError('NETWORK_ERROR', msg, { retryable, cause: err });
}

/**
 * Normalize tool calls; gateway creates ids when absent.
 * @param {unknown} raw
 * @returns {ToolCall[]}
 */
function normalizeToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || item.function?.name || '');
    if (!name) continue;
    let args = item.arguments ?? item.function?.arguments ?? item.input ?? {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        const err = new GatewayError('TOOL_ARGS_INVALID', `unparseable tool arguments for ${name}`, {
          retryable: false,
        });
        throw err;
      }
    }
    if (args == null || typeof args !== 'object' || Array.isArray(args)) {
      throw new GatewayError('TOOL_ARGS_INVALID', `tool arguments for ${name} must be an object`, {
        retryable: false,
      });
    }
    const id =
      typeof item.id === 'string' && item.id
        ? item.id
        : `tool_${name}_${out.length}_${Math.random().toString(36).slice(2, 10)}`;
    out.push({ id, name, arguments: args });
  }
  return out;
}

module.exports = {
  GatewayError,
  isRetryableStatus,
  errorFromStatus,
  asGatewayError,
  normalizeToolCalls,
  RETRYABLE_STATUS,
  NEVER_RETRY_STATUS,
};
