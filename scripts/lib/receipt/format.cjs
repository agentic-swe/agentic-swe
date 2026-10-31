const path = require('node:path');

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
  const lines = [];
  const headline = data.task ? `# /work ${data.workId} — ${data.task}` : `# /work ${data.workId}`;
  lines.push(headline, '');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Work ID | ${data.workId} |`);
  lines.push(`| Track | ${data.track} |`);
  lines.push(`| Status | ${data.status} |`);
  if (data.integrity) lines.push(`| Integrity | ${data.integrity} |`);
  if (data.historyGap) lines.push(`| History gap | ${data.historyGap} |`);
  if (data.durationSeconds != null) lines.push(`| Duration | ${formatDurationHuman(data.durationSeconds)} |`);
  lines.push(`| Cost | ${formatCost(data.costUsd)} |`);
  if (data.prUrl) lines.push(`| PR | ${data.prUrl} |`);
  lines.push('');
  if (data.decisions.length > 0) {
    lines.push(`## Decisions made (${data.decisions.length})`, '');
    data.decisions.forEach((d, i) => {
      const line = `${i + 1}. **${d.phase} → ${d.destination}** (${formatCost(d.costUsd)}) — ${d.reason || 'no reason recorded'}`;
      const evidence = d.evidenceRefs.length > 0 ? ` → ${d.evidenceRefs.join(', ')}` : '';
      lines.push(line + evidence);
    });
    lines.push('');
  }
  if (data.humanGates.length > 0) {
    lines.push(`## Human gates respected (${data.humanGates.length})`, '');
    data.humanGates.forEach((g) => {
      lines.push(`- \`${g.state}\` resolved by ${g.resolvedBy} at ${g.at} — ${g.reason}`);
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
  lines.push('');
  return lines.join('\n');
}

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

module.exports = { formatMarkdown, formatJson, formatCost, formatDurationHuman, displayWorkDir };
