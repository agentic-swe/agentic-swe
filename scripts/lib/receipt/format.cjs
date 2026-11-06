const path = require('node:path');
const { redactSecrets } = require('../shared/redact.cjs');

function formatCost(usd) {
  return `$${Number(usd).toFixed(2)}`;
}

// Render workDir as a path relative to cwd when it's a subpath, otherwise absolute.
// Keeps rendered receipts portable (no leaking of local user home dirs into docs / shared output)
// while preserving a verifiable, copy-pasteable reference for the reader.
function displayWorkDir(workDir, cwd) {
  const base = cwd || process.cwd();
  const rel = path.relative(base, workDir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return workDir;
  return rel;
}

function formatDurationHuman(seconds) {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hrs} hr ${mins} min`;
}

function formatMarkdown(data) {
  const safe = (value) => redactSecrets(String(value ?? '')).redacted;
  const lines = [];
  const headline = data.task ? `# /work ${safe(data.workId)} — ${safe(data.task)}` : `# /work ${safe(data.workId)}`;
  lines.push(headline, '');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Work ID | ${safe(data.workId)} |`);
  lines.push(`| Track | ${safe(data.track)} |`);
  lines.push(`| Status | ${safe(data.status)} |`);
  if (data.integrity) lines.push(`| Integrity | ${safe(data.integrity)} |`);
  if (data.historyGap) lines.push(`| History gap | ${safe(data.historyGap)} |`);
  if (data.durationSeconds != null) lines.push(`| Duration | ${formatDurationHuman(data.durationSeconds)} |`);
  lines.push(`| Cost | ${formatCost(data.costUsd)} |`);
  if (data.prUrl) lines.push(`| PR | ${safe(data.prUrl)} |`);
  lines.push('');
  if (data.decisions.length > 0) {
    lines.push(`## Decisions made (${data.decisions.length})`, '');
    data.decisions.forEach((d, i) => {
      const source = d.source_seq != null ? ` [source_seq: ${d.source_seq}]` : '';
      const line = `${i + 1}. **${safe(d.phase)} → ${safe(d.destination)}** (${formatCost(d.costUsd)}) — ${safe(d.reason || 'no reason recorded')}${source}`;
      const evidence = d.evidenceRefs.length > 0 ? ` → ${safe(d.evidenceRefs.join(', '))}` : '';
      lines.push(line + evidence);
    });
    lines.push('');
  }
  if (data.humanGates.length > 0) {
    lines.push(`## Human gates respected (${data.humanGates.length})`, '');
    data.humanGates.forEach((g) => {
      lines.push(`- \`${safe(g.state)}\` resolved by ${safe(g.resolvedBy)} at ${safe(g.at)} — ${safe(g.reason)}`);
    });
    lines.push('');
  }
  const counterEntries = Object.entries(data.counters);
  if (counterEntries.length > 0) {
    lines.push('## Loop counters', '');
    counterEntries.forEach(([k, v]) => lines.push(`- \`${k}\`: ${v}`));
    lines.push('');
  }
  lines.push('## Verifiable references', '');
  const wd = displayWorkDir(data.workDir);
  lines.push(`- All artifacts: \`${wd}/\``);
  lines.push(`- Audit log: \`${wd}/audit.log\` (${data.auditEntryCount} entries)`);
  if (data.toolCallCount) {
    lines.push(`- Policy-checked tool calls: ${data.toolCallCount} (${data.toolCallDenied || 0} denied by policy)`);
  }
  if (data.policyDecisions && data.policyDecisions.length) {
    lines.push(`- Policy decisions: ${data.policyDecisions.length}`);
  }
  if (data.usage && data.usage.length) {
    lines.push(`- Usage events: ${data.usage.length}`);
  }
  if (data.artifacts && data.artifacts.length) {
    lines.push(`- Artifacts with SHA-256 digests: ${data.artifacts.length}`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

module.exports = { formatMarkdown, formatJson, formatCost, formatDurationHuman, displayWorkDir };
