'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_PATH = path.join(__dirname, '..', '..', '..', 'schemas', 'agentic-swe-policy.schema.json');

let cachedValidator = null;
function validator() {
  if (cachedValidator) return cachedValidator;
  const Ajv = require('ajv').default;
  const ajv = new Ajv({ allErrors: true, strict: true });
  cachedValidator = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')));
  return cachedValidator;
}

/**
 * @param {unknown} policy
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePolicy(policy) {
  const validate = validator();
  if (validate(policy)) return { ok: true, errors: [] };
  const errors = (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`);
  return { ok: false, errors };
}

module.exports = { validatePolicy, SCHEMA_PATH };
