'use strict';

const crypto = require('node:crypto');

/**
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 1e-12 ? dot / d : 0;
}

/** @param {string} text @param {number} dim */
function testEmbedding(text, dim) {
  const h = crypto.createHash('sha256').update(String(text), 'utf8').digest();
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    const j = i % h.length;
    const k = (i * 7 + 3) % h.length;
    out[i] = ((h[j] / 255) * 2 - 1) * 0.3 + ((h[k] / 255) * 2 - 1) * 0.05;
  }
  let n = 0;
  for (let i = 0; i < dim; i++) n += out[i] * out[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dim; i++) out[i] /= n;
  return out;
}

/**
 * @param {object} merged from loadMergedMemoryConfig
 * @returns {{ backend: string, modelId: string, testDim?: number, ollamaHost?: string, model?: string } | null}
 */
function resolveEmbeddingRuntime(merged) {
  const emb = merged.embeddings || {};
  if (!emb.enabled) return null;

  const envBack = process.env.AGENTIC_SWE_EMBEDDINGS_BACKEND;
  const backend = (
    envBack != null && String(envBack).trim() !== ''
      ? String(envBack)
      : String(emb.provider != null ? emb.provider : 'none')
  )
    .toLowerCase()
    .trim();

  if (backend === 'none' || backend === '') return null;

  const testDimRaw = emb.test_dimension != null ? Number(emb.test_dimension) : 32;
  const testDim = Math.min(4096, Math.max(8, Number.isFinite(testDimRaw) ? testDimRaw : 32));

  if (backend === 'test') {
    const modelId = `test:dim${testDim}`;
    return { backend: 'test', modelId, testDim };
  }

  if (backend === 'ollama') {
    const model = process.env.AGENTIC_SWE_OLLAMA_MODEL || emb.model || 'nomic-embed-text';
    const host = (
      process.env.AGENTIC_SWE_OLLAMA_HOST || emb.ollama_host || 'http://127.0.0.1:11434'
    ).replace(/\/$/, '');
    const modelId = `ollama:${model}`;
    return { backend: 'ollama', modelId, ollamaHost: host, model };
  }

  if (backend === 'openai') {
    const model =
      process.env.AGENTIC_SWE_OPENAI_EMBEDDING_MODEL || emb.openai_model || 'text-embedding-3-small';
    const modelId = `openai:${model}`;
    return { backend: 'openai', modelId, model };
  }

  return null;
}

/**
 * @param {string} text
 * @param {NonNullable<ReturnType<typeof resolveEmbeddingRuntime>>} rt
 */
async function embedText(text, rt) {
  if (rt.backend === 'test') {
    const vec = testEmbedding(text, rt.testDim);
    return { vec, dim: vec.length, modelId: rt.modelId };
  }
  if (rt.backend === 'ollama') {
    const url = `${rt.ollamaHost}/api/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: rt.model, prompt: text }),
    });
    if (!res.ok) {
      throw new Error(`ollama embeddings HTTP ${res.status}`);
    }
    const data = await res.json();
    const arr = data.embedding;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('ollama embeddings: empty embedding');
    }
    const vec = Float32Array.from(arr);
    return { vec, dim: vec.length, modelId: rt.modelId };
  }
  if (rt.backend === 'openai') {
    const key = process.env.OPENAI_API_KEY || process.env.AGENTIC_SWE_OPENAI_API_KEY;
    if (!key) {
      throw new Error('openai embeddings: set OPENAI_API_KEY or AGENTIC_SWE_OPENAI_API_KEY');
    }
    const url = process.env.AGENTIC_SWE_OPENAI_BASE_URL || 'https://api.openai.com/v1/embeddings';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: rt.model, input: text }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`openai embeddings HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const arr = data.data && data.data[0] && data.data[0].embedding;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('openai embeddings: empty embedding');
    }
    const vec = Float32Array.from(arr);
    return { vec, dim: vec.length, modelId: rt.modelId };
  }
  return null;
}

module.exports = {
  resolveEmbeddingRuntime,
  embedText,
  cosineSimilarity,
};
