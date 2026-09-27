'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('./hash.cjs');
const { classifyDestination, readManifest, writeManifest } = require('./manifest.cjs');

function copyOwned(packRoot, destination, relative) {
  const source = path.join(packRoot, relative);
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function listInstalled({ destination, packFiles }) {
  const manifest = readManifest(destination) || { files: [] };
  return classifyDestination({ destination, manifest, packFiles });
}

function repair({ destination, packRoot, packFiles, dryRun }) {
  const manifest = readManifest(destination) || {
    schema_version: 1, installer_version: '0.0.0', host: 'unknown', profile: 'core',
    files: [], edits: [], external_registrations: [],
    last_scan: { status: 'clean', critical: 0, high: 0, medium: 0, low: 0, receipt: null },
  };
  const classified = classifyDestination({ destination, manifest, packFiles });
  const changes = [];
  for (const entry of classified.unreadable || []) {
    changes.push(`skip unreadable ${entry.path}: ${entry.error}`);
  }
  for (const relative of classified.drifted) {
    if (!packFiles.has(relative)) continue;
    changes.push(`restore ${relative}`);
    if (!dryRun) copyOwned(packRoot, destination, relative);
  }
  for (const relative of classified.adoptable) {
    changes.push(`adopt ${relative}`);
    if (!dryRun) manifest.files.push({ path: relative, sha256: packFiles.get(relative) });
  }
  if (!dryRun) {
    for (const relative of classified.drifted.filter((file) => packFiles.has(file))) {
      const record = manifest.files.find((file) => file.path === relative);
      record.sha256 = sha256File(path.join(destination, relative));
    }
    writeManifest(destination, manifest);
  }
  const outcome = dryRun ? classified : classifyDestination({ destination, manifest, packFiles });
  return { ...outcome, changes };
}

function updateInstalled({ destination, packRoot, packFiles, dryRun }) {
  const manifest = readManifest(destination);
  if (!manifest) throw new Error('corrupt manifest');
  const changes = [];
  for (const file of manifest.files) {
    if (!packFiles.has(file.path)) continue;
    changes.push(`update ${file.path}`);
    if (!dryRun) {
      copyOwned(packRoot, destination, file.path);
      file.sha256 = sha256File(path.join(destination, file.path));
    }
  }
  if (!dryRun) writeManifest(destination, manifest);
  return { ...classifyDestination({ destination, manifest, packFiles }), changes };
}

function uninstall({ destination, dryRun }) {
  const manifest = readManifest(destination);
  if (!manifest) throw new Error('corrupt manifest');
  const changes = [];
  const drifted = [];
  for (const file of manifest.files) {
    const full = path.join(destination, file.path);
    if (!fs.existsSync(full)) continue;
    if (sha256File(full) !== file.sha256) {
      drifted.push(file.path);
      continue;
    }
    changes.push(`remove ${file.path}`);
    if (!dryRun) fs.rmSync(full, { force: true });
  }
  const preserved = [];
  for (const edit of manifest.edits || []) {
    const edited = applyEdit(path.join(destination, edit.path), edit, dryRun);
    if (edited) changes.push(`reverse ${edit.path}`);
    else preserved.push(edit.path);
  }
  const manual = (manifest.external_registrations || []).map((item) => `${item.host}:${item.id}`);
  if (!dryRun && drifted.length === 0) fs.rmSync(path.join(destination, 'install-state.json'), { force: true });
  return { current: [], drifted, preserved, adoptable: [], changes, manual };
}

function applyEdit(filePath, edit, dryRun) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf8');
  let next = content;
  if (edit.type === 'policy-append' && content.endsWith(edit.body)) next = content.slice(0, -edit.body.length);
  if (edit.type === 'json-plugin-entry') {
    const parsed = JSON.parse(content);
    parsed.plugins = (parsed.plugins || []).filter((plugin) => !(plugin && plugin.name === edit.match.name && plugin.entry === edit.match.entry));
    next = `${JSON.stringify(parsed, null, 2)}\n`;
  }
  if (edit.type === 'gitignore-line') next = content.replace(/\n?\.worklogs\/\n/, '\n');
  if (edit.type === 'json-merge') {
    const parsed = JSON.parse(content);
    const cleaned = subtractJsonAdditions(parsed, edit.added);
    next = `${JSON.stringify(cleaned, null, 2)}\n`;
  }
  if (next === content) return false;
  if (!dryRun) fs.writeFileSync(filePath, next);
  return true;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function adapterIdentity(value) {
  if (!value || typeof value !== 'object') return null;
  const commands = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (['command', 'bash', 'powershell'].includes(key) && typeof child === 'string') commands.push(child);
      else visit(child);
    }
  }
  visit(value);
  for (const command of commands) {
    const normalized = command.replace(/\\/g, '/');
    if (!/(?:\.agentic-swe|CLAUDE_PLUGIN_ROOT).*host-lifecycle\.cjs/.test(normalized)) continue;
    const match = command.match(/--host\s+([^\s"']+)\s+--event\s+([^\s"']+)/);
    if (match) return `${match[1]}:${match[2]}`;
  }
  return null;
}

function subtractJsonAdditions(current, added) {
  if (Array.isArray(current) && Array.isArray(added)) {
    const identities = new Set(added.map(adapterIdentity).filter(Boolean));
    const exact = new Set(added.map(stableJson));
    return current.filter((value) => {
      const identity = adapterIdentity(value);
      return !exact.has(stableJson(value)) && !(identity && identities.has(identity));
    });
  }
  if (
    current &&
    added &&
    typeof current === 'object' &&
    typeof added === 'object' &&
    !Array.isArray(current) &&
    !Array.isArray(added)
  ) {
    const cleaned = { ...current };
    for (const [key, value] of Object.entries(added)) {
      if (!Object.prototype.hasOwnProperty.call(cleaned, key)) continue;
      if (stableJson(cleaned[key]) === stableJson(value)) delete cleaned[key];
      else cleaned[key] = subtractJsonAdditions(cleaned[key], value);
    }
    return cleaned;
  }
  return current;
}

module.exports = { applyEdit, listInstalled, repair, updateInstalled, uninstall };
