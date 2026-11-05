# ADR-008 — Provider-agnostic model gateway; usage from provider responses

- **Status:** Accepted
- **Date:** 2026-11-06
- **Decider:** founder
- **Related:** ADR-001, ADR-006, ADR-009

## Context

AutoEng needs one interface for model calls so the runtime stays single-language and is not shaped around one vendor. For M2 the founder decided that the two validation providers are local models (Ollama and llama.cpp), and that there is no paid LLM spend (the existing no-paid-spend decision stands). Review found these gaps in the original sketch and in the code it planned to reuse:

- The usage shape had no `cost_source`, latency, or `finish_reason`, and `ToolCall` / `Msg` were undefined. Ollama returns tool arguments as an object with no id; llama.cpp's OpenAI-compatible endpoint returns a JSON string with an id.
- `scripts/lib/work-engine/pricing.cjs` prices any unrecognized model at Sonnet rates and reads only Anthropic token field names, so a local model would be priced at $3/$15 per million tokens and unmapped usage would silently become 0.
- `transcript-sliding.cjs` and `embeddings-backend.cjs` default to `https://api.openai.com`, honor `AGENTIC_SWE_OPENAI_BASE_URL` / `AGENTIC_SWE_OLLAMA_HOST`, require a key, and set no timeout.
- Because Ollama also serves an OpenAI-style `/v1`, two local adapters could end up exercising the same shape.

## Decision

AutoEng owns a provider-neutral `ModelGateway` / `ProviderAdapter` contract. Adapters live under one adapters directory. No provider name is referenced outside it (static check). Each adapter uses an injected transport and an explicit base URL taken only from schema-validated gateway config: no vendor default, and `AGENTIC_SWE_OPENAI_BASE_URL`, `AGENTIC_SWE_OLLAMA_HOST`, and similar env variables are ignored.

Gateway config maps tier → model per provider. `frontier` is a schema tier; on a local-only configuration a frontier request returns `CAPABILITY_UNSUPPORTED` or is recorded `tier_degraded: true`. `Capabilities = {tools, json_schema, vision, context_tokens (effective), streaming}` come from discovery plus config overrides. `ToolCall = {id (gateway-created if absent), name, arguments: object}`; unparseable arguments give `TOOL_ARGS_INVALID`. `ModelResponse` adds `finish_reason` (`stop | length | tool_calls | error`) and a typed `GatewayError {code, retryable}`. `response_schema` is translated to the provider's native field where supported, and Ajv validates every result.

**Usage:** `{input|null, output|null, cache_read?, usage_source: provider|absent, usd|null, cost_source: local|price_table|provider|unknown, latency_ms, provider, model}`. Token counts come only from provider responses and are never zero-filled. Loopback providers record `usd: 0`, `cost_source: "local"`. A model not in a dated price table records `cost_source: "unknown"` and never falls back to a tier price; the gateway does not use `pricing.cjs`'s default-tier fallback. M2 calls are non-streaming, or stream only with usage explicitly requested. A timeout records `status: timeout`, `usage_known: false`.

**Security invariants (M2):**

1. Every `route()` call is evaluated by the AE-022 policy engine before any network I/O. Non-local providers are denied without a grant, and no grant exists in M2 (no paid spend). A $0 cost cap is not the mechanism.
2. A provider is local only if its host resolves to `127.0.0.0/8` or `::1`. The resolved IP is recorded in the decision, requests use `redirect: "error"`, and the request goes to the exact approved URL.
3. Local adapters never send credentials and are restricted to a model allow-list. Proxy adapters are excluded in M2. A loopback proxy to a paid vendor is a documented residual risk in cooperative mode.
4. Returned `tool_calls` must name an offered tool and validate against its schema, then pass the ADR-006 policy engine. Model output is never treated as policy or approval.
5. Journal events hold no prompt or response content. `raw_ref` blobs are redacted, mode 0600, referenced by digest, and excluded from receipts by default.
6. All model egress goes through the gateway. Other model callers are denied during hosted runs.

**Scope of M2 evidence:** M2 validates the interface on two loopback providers (Ollama native API, llama.cpp `llama-server` OpenAI-compatible API) plus a required hand-written Anthropic Messages fixture for shape coverage. This does not establish paid-vendor behavior, cost accuracy, or frontier capability, and exit criterion E2 is reported that way. Adding a paid adapter later requires a new ADR and a founder spend decision.

## Consequences

- AE-019a must make `cost_source`, `usage_source`, `finish_reason`, `GatewayError`, and `ToolCall` normalization required, and must not route through the `pricing.cjs` default-tier fallback.
- AE-019b ships only loopback adapters with no credentials.
- Reviewer "independence" between two local models is nominal and is reported as such.

## Alternatives

- LiteLLM, Vercel AI SDK, OpenRouter: rejected for M2 (RFC AE-010 §6).
