'use strict';

const { GatewayError, asGatewayError } = require('./types.cjs');
const { resolveCost } = require('./cost.cjs');
const { redactSecrets, redactDeep } = require('../shared/redact.cjs');
const { appendEvent } = require('../shared/journal.cjs');

/**
 * @param {{
 *   config: object,
 *   adapters: Record<string, object>,
 *   transport?: Function,
 *   journal?: { appendEvent?: Function, record?: Function },
 *   workDir?: string,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} opts
 */
function createModelGateway(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new GatewayError('CONFIG_INVALID', 'createModelGateway requires options');
  }
  const config = opts.config || {};
  const adapters = opts.adapters || {};
  const transport = opts.transport;
  const workDir = opts.workDir;
  const journal = opts.journal || null;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const sleep =
    typeof opts.sleep === 'function'
      ? opts.sleep
      : (ms) => new Promise((r) => setTimeout(r, ms));

  const provider = config.provider || 'fixture';
  const adapter = adapters[provider];
  if (!adapter) {
    throw new GatewayError('CONFIG_INVALID', `no adapter registered for provider ${provider}`);
  }

  const timeoutMs = Number(config.timeout_ms) > 0 ? Number(config.timeout_ms) : 5000;
  const maxRetries = Number.isFinite(Number(config.max_retries)) ? Number(config.max_retries) : 2;
  const maxRepairAttempts = Number.isFinite(Number(config.max_repair_attempts))
    ? Number(config.max_repair_attempts)
    : 1;
  const fallbackEnabled = config.fallback !== false;

  function modelCandidates(tier) {
    const raw = config.models && config.models[tier];
    if (raw == null) return [];
    return Array.isArray(raw) ? raw.map(String) : [String(raw)];
  }

  function capabilitiesFor(model) {
    if (config.capabilities && config.capabilities[model]) {
      const c = config.capabilities[model];
      return {
        tools: Boolean(c.tools),
        json_schema: Boolean(c.json_schema),
        vision: Boolean(c.vision),
        context_tokens: Number(c.context_tokens) || 0,
        streaming: Boolean(c.streaming),
      };
    }
    if (typeof adapter.discoverCapabilities === 'function') {
      return adapter.discoverCapabilities(model);
    }
    return {
      tools: false,
      json_schema: false,
      vision: false,
      context_tokens: 0,
      streaming: false,
    };
  }

  function requiredCapabilities(req) {
    /** @type {Record<string, boolean|number>} */
    const need = { ...(req.capabilities_required || {}) };
    if (Array.isArray(req.tools) && req.tools.length) need.tools = true;
    if (req.response_schema) need.json_schema = true;
    if (messagesNeedVision(req.messages)) need.vision = true;
    return need;
  }

  function missingCapability(caps, need) {
    if (need.tools && !caps.tools) return 'tools';
    if (need.json_schema && !caps.json_schema) return 'json_schema';
    if (need.vision && !caps.vision) return 'vision';
    if (need.context_tokens != null) {
      const want = Number(need.context_tokens);
      if (Number.isFinite(want) && want > 0 && !(Number(caps.context_tokens) >= want)) {
        return 'context_tokens';
      }
    }
    return null;
  }

  function selectModel(tier, need) {
    const candidates = modelCandidates(tier);
    if (!candidates.length) {
      throw new GatewayError('CONFIG_INVALID', `no model configured for tier ${tier}`, {
        retryable: false,
      });
    }
    const primary = candidates[0];
    const primaryCaps = capabilitiesFor(primary);
    const miss = missingCapability(primaryCaps, need);
    if (!miss) return { model: primary, fallback_from: null, capability: null };

    if (!fallbackEnabled) {
      return { model: primary, fallback_from: null, capability: miss, unsupported: true };
    }

    for (const alt of candidates.slice(1)) {
      const caps = capabilitiesFor(alt);
      if (!missingCapability(caps, need)) {
        return { model: alt, fallback_from: primary, capability: null };
      }
    }

    // Also scan other models listed under the same tier-named capability map keys
    // that appear in any models[*] list for this tier only (already covered), then fail.
    return { model: primary, fallback_from: null, capability: miss, unsupported: true };
  }

  async function recordUsage(payload, idempotency_key) {
    const safe = /** @type {object} */ (redactDeep(payload));
    const spec = {
      type: 'usage.recorded',
      payload: safe,
      idempotency_key,
    };
    if (journal && typeof journal.record === 'function') {
      return journal.record(workDir, spec);
    }
    if (journal && typeof journal.appendEvent === 'function') {
      return journal.appendEvent(workDir, spec);
    }
    if (workDir) {
      return appendEvent(workDir, spec);
    }
    return null;
  }

  /**
   * @param {{
   *   tier: string,
   *   messages: object[],
   *   tools?: object[],
   *   response_schema?: object,
   *   idempotency_key: string,
   *   capabilities_required?: object,
   *   scenario?: string,
   * }} req
   */
  async function route(req) {
    if (!req || typeof req !== 'object') {
      throw new GatewayError('BAD_REQUEST', 'route requires a request object');
    }
    if (!req.idempotency_key || typeof req.idempotency_key !== 'string') {
      throw new GatewayError('BAD_REQUEST', 'idempotency_key is required');
    }

    const started = now();
    const need = requiredCapabilities(req);
    const selected = selectModel(req.tier, need);

    if (selected.unsupported) {
      const capability = selected.capability || 'unknown';
      const err = new GatewayError(
        'CAPABILITY_UNSUPPORTED',
        `capability unsupported: ${capability}`,
        { retryable: false, capability }
      );
      await recordUsage(
        {
          provider,
          model: selected.model,
          input: null,
          output: null,
          usage_source: 'absent',
          usd: 0,
          cost_source: 'local',
          latency_ms: Math.max(0, now() - started),
          status: 'error',
          finish_reason: 'error',
          error_code: 'CAPABILITY_UNSUPPORTED',
          capability,
        },
        req.idempotency_key
      );
      throw sanitizeError(err);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    /** @type {object|null} */
    let lastResponse = null;
    /** @type {GatewayError|null} */
    let lastError = null;
    let timedOut = false;
    let repairLeft = maxRepairAttempts;
    let attempt = 0;

    try {
      while (true) {
        if (controller.signal.aborted) {
          timedOut = true;
          break;
        }

        try {
          const messages = lastResponse && repairLeft < maxRepairAttempts
            ? appendRepairMessage(req.messages, lastResponse, req.response_schema)
            : req.messages;

          const raw = await adapter.complete({
            model: selected.model,
            messages,
            tools: req.tools,
            response_format: req.response_schema
              ? { type: 'json_schema', json_schema: { schema: req.response_schema } }
              : undefined,
            signal: controller.signal,
            transport,
            scenario: req.scenario,
          });

          if (controller.signal.aborted) {
            timedOut = true;
            break;
          }

          lastResponse = finalizeResponse(raw, selected, started);
          lastError = null;

          if (req.response_schema) {
            const valid = validateAgainstSchema(lastResponse.content, req.response_schema);
            if (!valid.ok) {
              if (repairLeft > 0) {
                repairLeft -= 1;
                continue;
              }
              const err = new GatewayError(
                'STRUCTURED_OUTPUT_INVALID',
                `output violated response_schema: ${valid.message}`,
                { retryable: false, details: valid }
              );
              await recordUsage(
                usagePayload(lastResponse, {
                  status: 'error',
                  finish_reason: 'error',
                  error_code: 'STRUCTURED_OUTPUT_INVALID',
                  latency_ms: Math.max(0, now() - started),
                }),
                req.idempotency_key
              );
              throw sanitizeError(err);
            }
          }

          await recordUsage(
            usagePayload(lastResponse, {
              status: 'ok',
              finish_reason: lastResponse.finish_reason,
              latency_ms: Math.max(0, now() - started),
              fallback_from: selected.fallback_from || undefined,
            }),
            req.idempotency_key
          );
          return lastResponse;
        } catch (err) {
          if (controller.signal.aborted || (err && err.name === 'AbortError')) {
            timedOut = true;
            break;
          }
          const ge = err instanceof GatewayError ? err : asGatewayError(err);
          if (ge.code === 'TIMEOUT') {
            timedOut = true;
            lastError = ge;
            break;
          }
          if (ge.code === 'STRUCTURED_OUTPUT_INVALID' || ge.code === 'CAPABILITY_UNSUPPORTED') {
            throw sanitizeError(ge);
          }
          lastError = sanitizeError(ge);
          if (!ge.retryable || attempt >= maxRetries) {
            await recordUsage(
              {
                provider,
                model: selected.model,
                input: null,
                output: null,
                usage_source: 'absent',
                ...costFields(provider, selected.model, null, null),
                latency_ms: Math.max(0, now() - started),
                status: 'error',
                finish_reason: 'error',
                error_code: ge.code,
                fallback_from: selected.fallback_from || undefined,
              },
              req.idempotency_key
            );
            throw lastError;
          }
          attempt += 1;
          const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
          await sleep(delay);
        }
      }
    } finally {
      clearTimeout(timer);
    }

    if (timedOut) {
      const err = new GatewayError('TIMEOUT', `call exceeded timeout_ms=${timeoutMs}`, {
        retryable: false,
      });
      await recordUsage(
        {
          provider,
          model: selected.model,
          input: null,
          output: null,
          usage_source: 'absent',
          usage_known: false,
          ...costFields(provider, selected.model, null, null),
          latency_ms: Math.max(0, now() - started),
          status: 'timeout',
          finish_reason: 'error',
          error_code: 'TIMEOUT',
          fallback_from: selected.fallback_from || undefined,
        },
        req.idempotency_key
      );
      throw sanitizeError(err);
    }

    throw lastError || new GatewayError('PROVIDER_ERROR', 'route failed', { retryable: false });
  }

  function finalizeResponse(raw, selected, started) {
    const input = raw.usage?.input ?? null;
    const output = raw.usage?.output ?? null;
    const cache_read = raw.usage?.cache_read ?? null;
    const usage_source = raw.usage?.usage_source || (input == null && output == null ? 'absent' : 'provider');
    // Gateway-selected model is authoritative (fixture bodies may echo a canned model id).
    const model = selected.model;
    const prov = raw.provider || provider;
    const cost = resolveCost({
      provider: prov,
      model,
      input,
      output,
      cache_read,
      local: prov === 'fixture',
    });
    return {
      content: raw.content ?? null,
      tool_calls: Array.isArray(raw.tool_calls) ? raw.tool_calls : [],
      finish_reason: raw.finish_reason || 'stop',
      model,
      provider: prov,
      fallback_from: selected.fallback_from,
      usage: {
        input,
        output,
        cache_read,
        usage_source,
        usd: cost.usd,
        cost_source: cost.cost_source,
        latency_ms: Math.max(0, now() - started),
        provider: prov,
        model,
      },
      raw: raw.raw,
    };
  }

  function usagePayload(response, extra) {
    return {
      provider: response.provider,
      model: response.model,
      input: response.usage.input,
      output: response.usage.output,
      cache_read: response.usage.cache_read,
      usage_source: response.usage.usage_source,
      usd: response.usage.usd,
      cost_source: response.usage.cost_source,
      latency_ms: extra.latency_ms != null ? extra.latency_ms : response.usage.latency_ms,
      status: extra.status,
      finish_reason: extra.finish_reason,
      fallback_from: extra.fallback_from,
      error_code: extra.error_code,
    };
  }

  function costFields(prov, model, input, output) {
    const cost = resolveCost({ provider: prov, model, input, output, local: prov === 'fixture' });
    return { usd: cost.usd, cost_source: cost.cost_source };
  }

  return {
    route,
    provider,
    capabilitiesFor,
    _config: config,
  };
}

function messagesNeedVision(messages) {
  if (!Array.isArray(messages)) return false;
  for (const m of messages) {
    const c = m && m.content;
    if (Array.isArray(c)) {
      for (const part of c) {
        if (part && (part.type === 'image' || part.type === 'image_url' || part.type === 'input_image')) {
          return true;
        }
      }
    }
  }
  return false;
}

function appendRepairMessage(messages, lastResponse, schema) {
  const base = Array.isArray(messages) ? messages.slice() : [];
  base.push({
    role: 'assistant',
    content: lastResponse.content || '',
  });
  base.push({
    role: 'user',
    content: `Your previous output did not match the required JSON schema. Reply with valid JSON only. Schema: ${JSON.stringify(schema)}`,
  });
  return base;
}

function validateAgainstSchema(content, schema) {
  if (content == null || content === '') {
    return { ok: false, message: 'empty content' };
  }
  let parsed;
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : content;
  } catch (err) {
    return { ok: false, message: `invalid JSON: ${err.message}` };
  }
  try {
    const Ajv = require('ajv').default;
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(parsed);
    if (!ok) {
      const msg = (validate.errors || []).map((e) => `${e.instancePath} ${e.message}`).join('; ');
      return { ok: false, message: msg || 'schema mismatch' };
    }
    return { ok: true, value: parsed };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

function sanitizeError(err) {
  if (!(err instanceof GatewayError)) {
    const ge = asGatewayError(err);
    ge.message = redactSecrets(ge.message).redacted;
    return ge;
  }
  err.message = redactSecrets(err.message).redacted;
  if (err.details) err.details = redactDeep(err.details);
  return err;
}

module.exports = { createModelGateway, validateAgainstSchema };
