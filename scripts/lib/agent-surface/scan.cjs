'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RULES = [
  ['secret-hardcoded', 'critical', /(?:AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|TYPESAFE_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9_\-]{8,})/],
  ['permission-unrestricted-shell', 'critical', /Bash\(\*\)/],
  ['hook-command-injection', 'critical', /\$\{(?:TOOL_INPUT|FILE|ARGUMENTS)\}/],
  ['policy-auto-run-unsafe', 'critical', /--dangerously-skip-permissions|bypass permission prompts/i],
  ['permission-missing-deny', 'high', /"allow"\s*:\s*\[[^\]]*"Bash\(\*\)"[^\]]*\](?![\s\S]{0,200}"deny")/],
  ['mcp-autoinstall', 'high', /npx\s+-y\s+/],
  ['hook-hidden-failure', 'medium', /\|\|\s*true|2>\s*\/dev\/null/],
  ['mcp-missing-description', 'low', /"mcpServers"\s*:\s*\{[\s\S]*?\{\s*\}/],
];

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function scanText(filePath, content) {
  const findings = [];
  for (const [rule, severity, pattern] of RULES) {
    const match = pattern.exec(content);
    if (!match) continue;
    const line = lineOf(content, match.index);
    findings.push({
      id: `${rule}:${filePath}:${line}`,
      rule,
      severity,
      path: filePath,
      line,
      evidence: match[0].slice(0, 120),
      message: `${rule} at ${filePath}:${line}`,
    });
  }
  return findings;
}

function walk(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      files.push(...walk(full));
    } else if (entry.isFile()) files.push(full);
  }
  return files;
}

function summarize(findings) {
  const summary = { status: 'clean', critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  if (summary.critical > 0) summary.status = 'blocked';
  else if (findings.length > 0) summary.status = 'warnings';
  return summary;
}

function scanSurfaces({ roots = [], plannedWrites = [] } = {}) {
  const findings = [];
  for (const planned of plannedWrites) findings.push(...scanText(planned.path, planned.content));
  for (const root of roots) {
    for (const file of walk(root)) {
      findings.push(...scanText(path.relative(root, file), fs.readFileSync(file, 'utf8')));
    }
  }
  return { findings, summary: summarize(findings) };
}

module.exports = { scanSurfaces };
