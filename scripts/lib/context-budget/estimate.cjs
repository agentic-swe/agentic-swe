'use strict';

function proseTokens(text) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.ceil(words * 1.3);
}

function estimateContext({ files, jevHintText = '', jevTaskText = '' }) {
  const components = { policy: 0, agentDescriptions: 0, skills: 0, mcpSchemas: 0, jevHint: proseTokens(jevHintText) };
  for (const file of files) {
    if (file.kind === 'policy') components.policy += proseTokens(file.content);
    if (file.kind === 'agent-description') components.agentDescriptions += proseTokens(file.content);
    if (file.kind === 'skill') components.skills += proseTokens(file.content);
    if (file.kind === 'mcp') components.mcpSchemas += 500 * Math.max(1, (file.content.match(/\{\s*\}/g) || []).length);
  }
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  const savings = [];
  if (components.jevHint > 0) savings.push({ action: 'AGENTIC_SWE_JEV=0', tokens: components.jevHint });
  return { total, components, jevTaskText: proseTokens(jevTaskText), savings };
}

module.exports = { estimateContext, proseTokens };
