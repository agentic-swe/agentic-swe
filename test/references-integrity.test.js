'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const referencesDir = path.join(repoRoot, 'references');
const templatesDir = path.join(repoRoot, 'templates');
const phasesDir = path.join(repoRoot, 'phases');

describe('references-integrity: reference files exist and are non-empty', () => {
  const files = fs.readdirSync(referencesDir).filter((f) => f.endsWith('.md'));

  it('has at least one reference file', () => {
    assert.ok(files.length > 0, 'no .md files in references/');
  });

  for (const file of files) {
    it(`references/${file} is non-empty`, () => {
      const body = fs.readFileSync(path.join(referencesDir, file), 'utf8');
      assert.ok(body.trim().length > 0, `${file} is empty`);
    });
  }
});

describe('references-integrity: template files exist and are non-empty', () => {
  const files = fs.readdirSync(templatesDir);

  it('has at least one template file', () => {
    assert.ok(files.length > 0, 'no files in templates/');
  });

  for (const file of files) {
    const full = path.join(templatesDir, file);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      it(`templates/${file}/ contains non-empty .md files`, () => {
        const subs = fs.readdirSync(full).filter((f) => f.endsWith('.md'));
        assert.ok(subs.length > 0, `templates/${file}/ has no .md files`);
        for (const sf of subs) {
          const b = fs.readFileSync(path.join(full, sf), 'utf8');
          assert.ok(b.trim().length > 0, `${file}/${sf} is empty`);
        }
      });
      continue;
    }
    if (!st.isFile()) continue;
    it(`templates/${file} is non-empty`, () => {
      const body = fs.readFileSync(full, 'utf8');
      assert.ok(body.trim().length > 0, `${file} is empty`);
    });
  }
});

describe('references-integrity: phase files cross-reference valid paths', () => {
  const phaseFiles = fs.readdirSync(phasesDir).filter((f) => f.endsWith('.md'));
  const refPattern =
    /\$\{CLAUDE_PLUGIN_ROOT\}\/(references|templates)\/([^\s)`'"<>]+\.(?:md|json))/g;

  for (const file of phaseFiles) {
    it(`phases/${file} references resolve to existing files`, () => {
      const body = fs.readFileSync(path.join(phasesDir, file), 'utf8');
      let match;
      const re = new RegExp(refPattern.source, 'g');
      while ((match = re.exec(body)) !== null) {
        const refPath = path.join(repoRoot, match[1], match[2]);
        assert.ok(
          fs.existsSync(refPath),
          `${file} references missing file: \${CLAUDE_PLUGIN_ROOT}/${match[1]}/${match[2]}`
        );
      }
    });
  }
});
