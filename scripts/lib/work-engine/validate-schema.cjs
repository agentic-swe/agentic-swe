'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {object} state
 * @param {string} pluginRoot agentic-swe pack root containing schemas/
 * @returns {{ ok: true } | { ok: false, errors: object[] }}
 */
function validateWorkItemSchemaAtRoot(state, pluginRoot) {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const Ajv = require('ajv/dist/2020').default;
  const ajv = new Ajv({ allErrors: true, strict: true });
  const schemaPath = path.join(pluginRoot, 'schemas', 'work-item.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const validate = ajv.compile(schema);
  const ok = validate(state);
  if (ok) return { ok: true };
  return { ok: false, errors: validate.errors || [] };
}

module.exports = { validateWorkItemSchemaAtRoot };
