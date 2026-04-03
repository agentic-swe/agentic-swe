'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const claudeDir = path.join(__dirname, '..', '.claude');
const referencesDir = path.join(claudeDir, 'references');
const templatesDir = path.join(claudeDir, 'templates');
const phasesDir = path.join(claudeDir, 'phases');

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
    it(`templates/${file} is non-empty`, () => {
      const body = fs.readFileSync(path.join(templatesDir, file), 'utf8');
      assert.ok(body.trim().length > 0, `${file} is empty`);
    });
  }
});

describe('references-integrity: phase files cross-reference valid paths', () => {
  const phaseFiles = fs.readdirSync(phasesDir).filter((f) => f.endsWith('.md'));
  const refPattern = /\.claude\/(references|templates)\/([\w][\w.-]*\.\w+)/g;

  for (const file of phaseFiles) {
    it(`phases/${file} references resolve to existing files`, () => {
      const body = fs.readFileSync(path.join(phasesDir, file), 'utf8');
      let match;
      while ((match = refPattern.exec(body)) !== null) {
        const refPath = path.join(claudeDir, match[1], match[2]);
        assert.ok(fs.existsSync(refPath), `${file} references missing file: .claude/${match[1]}/${match[2]}`);
      }
    });
  }
});
