'use strict';

/**
 * Format catalog-route hits as a feasibility.md section.
 * @param {{ query: string, mode?: string, hits: Array<{ id: string, score?: number }> }} input
 * @returns {string}
 */
function formatCatalogRoutingSection(input) {
  const query = String(input.query || '').trim() || '(unspecified)';
  const mode = String(input.mode || 'lexical');
  const hits = Array.isArray(input.hits) ? input.hits : [];
  const lines = [
    '## Catalog Routing',
    '',
    `- **Query**: ${query}`,
    `- **Mode**: ${mode}`,
    `- **Top-k**:`,
  ];
  if (hits.length === 0) {
    lines.push('  - (none)');
  } else {
    for (const hit of hits) {
      const score =
        typeof hit.score === 'number' ? ` (score ${hit.score.toFixed ? hit.score.toFixed(3) : hit.score})` : '';
      lines.push(`  - \`${hit.id}\`${score}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Insert or replace ## Catalog Routing in feasibility markdown.
 * @param {string} markdown
 * @param {string} sectionBody including heading
 */
function upsertCatalogRoutingSection(markdown, sectionBody) {
  const body = String(sectionBody || '').trimEnd() + '\n';
  const re = /^## Catalog Routing\b[\s\S]*?(?=^##\s|\s*$)/m;
  const src = String(markdown || '');
  if (re.test(src)) {
    return src.replace(re, body.trimEnd() + '\n\n');
  }
  return `${src.trimEnd()}\n\n${body}`;
}

module.exports = {
  formatCatalogRoutingSection,
  upsertCatalogRoutingSection,
};
