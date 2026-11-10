'use strict';

const os = require('node:os');

/** Characters that imply shell interpretation (not quote delimiters). */
const SHELL_META = /[$`|;&><\n\r]/;

/**
 * ADR-009: children start from a minimal env. Secrets (GITHUB_TOKEN, etc.) are
 * not inherited from process.env.
 * @param {Record<string, string>} [extra]
 */
function minimalChildEnv(extra = {}) {
  const env = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    LANG: process.env.LANG || 'C',
    CI: '1',
  };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value == null) continue;
    env[String(key)] = String(value);
  }
  return env;
}

/**
 * Split a command string into argv without invoking a shell.
 * Supports single/double quotes as delimiters; rejects shell metacharacters.
 * @param {string} raw
 * @returns {{ ok: true, argv: string[] } | { ok: false, code: string, message: string }}
 */
function tokenizeCommand(raw) {
  const argv = [];
  let cur = '';
  let quote = null; // "'" | '"' | null
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (ch === '\\' && quote === '"' && i + 1 < raw.length) {
        cur += raw[i + 1];
        i += 1;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur.length) {
        argv.push(cur);
        cur = '';
      }
      continue;
    }
    if (SHELL_META.test(ch)) {
      return {
        ok: false,
        code: 'SHELL_META',
        message: 'command contains shell metacharacters; use argv array',
      };
    }
    cur += ch;
  }
  if (quote) {
    return { ok: false, code: 'ARGV_INVALID', message: 'unclosed quote in command' };
  }
  if (cur.length) argv.push(cur);
  return { ok: true, argv };
}

/**
 * Resolve a string/argv command for shell:false spawn.
 * Rejects shell metacharacters; does not invoke /bin/sh.
 * @param {string|string[]} command
 */
function resolveCommandArgv(command) {
  if (command == null || command === '') {
    return { ok: true, empty: true };
  }
  if (Array.isArray(command)) {
    if (!command.length || command.some((c) => typeof c !== 'string' || !String(c).trim())) {
      return { ok: false, code: 'ARGV_INVALID', message: 'argv must be a non-empty array of non-empty strings' };
    }
    const argv = command.map(String);
    for (const part of argv) {
      if (SHELL_META.test(part)) {
        return { ok: false, code: 'SHELL_META', message: `argv element contains shell metacharacters: ${JSON.stringify(part)}` };
      }
    }
    return { ok: true, file: argv[0], args: argv.slice(1), display: JSON.stringify(argv) };
  }
  const raw = String(command).trim();
  if (!raw) return { ok: true, empty: true };
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return resolveCommandArgv(parsed);
    } catch {
      return { ok: false, code: 'ARGV_INVALID', message: 'command looks like JSON but failed to parse as argv' };
    }
  }
  const tok = tokenizeCommand(raw);
  if (!tok.ok) return tok;
  if (!tok.argv.length) return { ok: true, empty: true };
  return { ok: true, file: tok.argv[0], args: tok.argv.slice(1), display: raw };
}

module.exports = { minimalChildEnv, resolveCommandArgv, tokenizeCommand, SHELL_META };
