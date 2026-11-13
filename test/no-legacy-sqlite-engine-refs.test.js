'use strict';

/**
 * M4 audit NB1 — fail if legacy engine tokens reappear under scripts/ or test/.
 * Allowlist: ADR decision records (docs/adr/**) and CHANGELOG history only
 * (those paths are outside the scanned roots; listed for documentation).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');

/** Contiguous tokens that must not appear (built so this file stays clean). */
const BANNED = [
  ['sql', 'js'].join('.'),
  ['sql', 'js'].join(''),
];

const TEXT_EXT = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
  '.md',
  '.json',
  '.yml',
  '.yaml',
  '.sh',
  '.ps1',
  '.txt',
]);

/** Relative path prefixes/files allowed even if scanned (decision + changelog). */
const ALLOWLIST = [
  path.normalize('CHANGELOG.md'),
  path.normalize('docs/adr'),
];

/**
 * @param {string} rel
 */
function isAllowlisted(rel) {
  const n = path.normalize(rel);
  return ALLOWLIST.some(
    (a) => n === a || n.startsWith(`${a}${path.sep}`) || n.startsWith(`${a}/`)
  );
}

/**
 * @param {string} rootRel scripts | test
 * @returns {{ path: string, match: string }[]}
 */
function scanRoot(rootRel) {
  const absRoot = path.join(pluginRoot, rootRel);
  /** @type {{ path: string, match: string }[]} */
  const hits = [];
  if (!fs.existsSync(absRoot)) return hits;

  /**
   * @param {string} dir
   */
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      // Skip VCS, deps, and ephemeral test scratch dirs (_tmp-* / .tmp*).
      if (
        ent.name === 'node_modules' ||
        ent.name === '.git' ||
        ent.name.startsWith('_tmp') ||
        ent.name.startsWith('.tmp')
      ) {
        continue;
      }
      const full = path.join(dir, ent.name);
      const rel = path.relative(pluginRoot, full);
      if (isAllowlisted(rel)) continue;

      if (ent.isDirectory()) {
        // Directory names themselves must not carry banned tokens.
        const lowerName = ent.name.toLowerCase();
        for (const token of BANNED) {
          if (lowerName.includes(token.toLowerCase())) {
            hits.push({ path: rel, match: `dirname:${token}` });
          }
        }
        walk(full);
        continue;
      }

      const lowerName = ent.name.toLowerCase();
      for (const token of BANNED) {
        if (lowerName.includes(token.toLowerCase())) {
          hits.push({ path: rel, match: `filename:${token}` });
        }
      }

      const ext = path.extname(ent.name).toLowerCase();
      if (!TEXT_EXT.has(ext)) continue;

      let src;
      try {
        src = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const lower = src.toLowerCase();
      for (const token of BANNED) {
        if (lower.includes(token.toLowerCase())) {
          hits.push({ path: rel, match: `content:${token}` });
        }
      }
    }
  }

  walk(absRoot);
  return hits;
}

describe('no legacy sqlite engine token references (M4 NB1)', () => {
  it('scripts/** and test/** omit removed legacy engine tokens (ADR+CHANGELOG allowlisted)', () => {
    const hits = [...scanRoot('scripts'), ...scanRoot('test')];
    assert.deepEqual(
      hits,
      [],
      `banned legacy engine tokens found:\n${hits
        .map((h) => `  ${h.path} (${h.match})`)
        .join('\n')}`
    );
  });
});
