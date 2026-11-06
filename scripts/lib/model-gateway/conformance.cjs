'use strict';

const { GatewayError, isRetryableStatus, asGatewayError } = require('./types.cjs');
const { redactSecrets } = require('../shared/redact.cjs');

const CAP_KEYS = ['tools', 'json_schema', 'vision', 'context_tokens', 'streaming'];

/**
 * Adapter conformance suite (AE-019a).
 *
 * @param {{
 *   id: string,
 *   discoverCapabilities: (model: string) => object,
 *   complete: (req: object) => Promise<object>,
 * }} adapter
 * @param {{
 *   model?: string,
 *   transport?: Function,
 *   plantSecret?: string,
 * }} [harness]
 * @returns {Promise<{ ok: boolean, failures: string[] }>}
 */
async function runConformanceSuite(adapter, harness = {}) {
  const failures = [];
  const model = harness.model || 'conformance-model';

  if (!adapter || typeof adapter !== 'object') {
    return { ok: false, failures: ['adapter is missing'] };
  }
  if (typeof adapter.id !== 'string' || !adapter.id) {
    failures.push('adapter.id must be a non-empty string');
  }
  if (typeof adapter.discoverCapabilities !== 'function') {
    failures.push('adapter.discoverCapabilities must be a function');
  }
  if (typeof adapter.complete !== 'function') {
    failures.push('adapter.complete must be a function');
  }
  if (failures.length) return { ok: false, failures };

  // Capabilities object shape
  try {
    const caps = adapter.discoverCapabilities(model);
    if (!caps || typeof caps !== 'object' || Array.isArray(caps)) {
      failures.push('discoverCapabilities must return an object');
    } else {
      for (const key of CAP_KEYS) {
        if (!(key in caps)) {
          failures.push(`capabilities missing key: ${key}`);
          continue;
        }
        if (key === 'context_tokens') {
          if (typeof caps.context_tokens !== 'number' || !(caps.context_tokens > 0)) {
            failures.push('capabilities.context_tokens must be a positive number');
          }
        } else if (typeof caps[key] !== 'boolean') {
          failures.push(`capabilities.${key} must be boolean`);
        }
      }
    }
  } catch (err) {
    failures.push(`discoverCapabilities threw: ${err.message}`);
  }

  // AbortSignal respect
  try {
    const ac = new AbortController();
    ac.abort();
    let completed = false;
    try {
      await adapter.complete({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        signal: ac.signal,
        transport: harness.transport,
      });
      completed = true;
      failures.push('complete must reject when signal is already aborted');
    } catch (err) {
      if (completed) {
        /* already recorded */
      } else {
        const ge = err instanceof GatewayError ? err : asGatewayError(err);
        if (ge.code !== 'TIMEOUT' && err?.name !== 'AbortError' && !/abort|timeout/i.test(String(err.message))) {
          failures.push(`aborted complete should surface timeout/abort, got: ${ge.code || err.message}`);
        }
      }
    }
  } catch (err) {
    failures.push(`AbortSignal check failed: ${err.message}`);
  }

  // retryable flags for status codes via a transport that returns statuses
  const statusCases = [
    { status: 429, expectRetryable: true },
    { status: 500, expectRetryable: true },
    { status: 400, expectRetryable: false },
    { status: 401, expectRetryable: false },
    { status: 403, expectRetryable: false },
  ];

  for (const { status, expectRetryable } of statusCases) {
    const plant = harness.plantSecret || 'sk-conformancePlantedKeyAAAAAAAA';
    try {
      await adapter.complete({
        model,
        messages: [{ role: 'user', content: 'status-probe' }],
        transport: async () => ({
          status,
          error: { status, message: `upstream ${status} api_key=${plant}` },
        }),
      });
      failures.push(`expected error for status ${status}`);
    } catch (err) {
      const ge =
        err instanceof GatewayError
          ? err
          : new GatewayError(err.code || 'PROVIDER_ERROR', String(err.message), {
              retryable: err.retryable,
              status: err.status ?? status,
            });
      // Prefer GatewayError.retryable; fall back to status policy
      const retryable =
        typeof ge.retryable === 'boolean' ? ge.retryable : isRetryableStatus(ge.status ?? status);
      if (retryable !== expectRetryable) {
        failures.push(
          `status ${status}: retryable expected ${expectRetryable}, got ${retryable}`
        );
      }
      const msg = String(ge.message || '');
      const redacted = redactSecrets(msg).redacted;
      if (msg.includes(plant) || /sk-[A-Za-z0-9]{20,}/.test(msg)) {
        // Adapter may leak; suite requires no raw secrets in thrown messages.
        // If redaction would change it, the raw message still contains a secret → fail.
        if (redacted !== msg || msg.includes(plant)) {
          failures.push(`status ${status}: thrown message contains raw secret`);
        }
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

module.exports = { runConformanceSuite, CAP_KEYS };
