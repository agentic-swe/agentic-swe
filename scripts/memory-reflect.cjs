'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Extract failure-mode entries from a reflection-log.md.
 * Returns [{ category, whatFailed, rootCause, strategyChange, workId }]
 */
function parseReflectionLog(logPath, workId) {
  if (!fs.existsSync(logPath)) return [];
  const content = fs.readFileSync(logPath, 'utf8');
  const entries = [];
  const blocks = content.split(/^(?=- \*\*What failed\*\*)/m);

  for (const block of blocks) {
    const whatMatch = block.match(/\*\*What failed\*\*:\s*(.+)/);
    const rootMatch = block.match(/\*\*Root cause\*\*:\s*(.+)/);
    const stratMatch = block.match(/\*\*Strategy change\*\*:\s*(.+)/);
    if (!whatMatch) continue;

    const entry = {
      whatFailed: whatMatch[1].trim(),
      rootCause: rootMatch ? rootMatch[1].trim() : 'unknown',
      strategyChange: stratMatch ? stratMatch[1].trim() : 'none specified',
      workId,
      category: classifyFailure(rootMatch ? rootMatch[1] : ''),
    };
    entries.push(entry);
  }
  return entries;
}

/**
 * Rules-based failure category classifier.
 */
function classifyFailure(rootCauseText) {
  const text = (rootCauseText || '').toLowerCase();
  if (text.includes('test') || text.includes('coverage') || text.includes('assertion')) return 'test-gap';
  if (text.includes('type') || text.includes('interface') || text.includes('schema')) return 'type-mismatch';
  if (text.includes('scope') || text.includes('beyond') || text.includes('unrelated')) return 'scope-creep';
  if (text.includes('design') || text.includes('architect') || text.includes('pattern')) return 'design-flaw';
  if (text.includes('permission') || text.includes('security') || text.includes('auth')) return 'security';
  if (text.includes('performance') || text.includes('slow') || text.includes('timeout')) return 'performance';
  if (text.includes('dependency') || text.includes('version') || text.includes('compat')) return 'dependency';
  if (text.includes('ambig') || text.includes('unclear') || text.includes('missing req')) return 'ambiguity';
  return 'uncategorized';
}

/**
 * Scan all worklogs and produce a lessons digest.
 */
function buildLessons(worklogsDir) {
  if (!fs.existsSync(worklogsDir)) return { lessons: [], categories: {} };

  const allEntries = [];
  const dirs = fs.readdirSync(worklogsDir);
  for (const dir of dirs) {
    const logPath = path.join(worklogsDir, dir, 'reflection-log.md');
    const entries = parseReflectionLog(logPath, dir);
    allEntries.push(...entries);
  }

  const categories = {};
  for (const entry of allEntries) {
    if (!categories[entry.category]) categories[entry.category] = [];
    categories[entry.category].push(entry);
  }

  return { lessons: allEntries, categories };
}

/**
 * Write lessons digest to .agentic-swe/lessons.json
 */
function writeLessons(repoRoot) {
  const worklogsDir = path.join(repoRoot, '.worklogs');
  const outputDir = path.join(repoRoot, '.agentic-swe');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const { lessons, categories } = buildLessons(worklogsDir);
  const output = {
    generated_at: new Date().toISOString(),
    total_lessons: lessons.length,
    categories: Object.fromEntries(
      Object.entries(categories).map(([cat, entries]) => [cat, entries.length])
    ),
    lessons,
  };

  const outPath = path.join(outputDir, 'lessons.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  return outPath;
}

if (require.main === module) {
  const repoRoot = path.resolve(process.argv[2] || process.cwd());
  const outPath = writeLessons(repoRoot);
  const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));

  let stylePath = null;
  try {
    const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
    const { buildStyleProfile, writeStyleProfile } = require('./lib/memory/style-profile.cjs');
    const profile = buildStyleProfile({
      projectRoot: repoRoot,
      pluginRoot: getDefaultPluginRoot(),
    });
    writeStyleProfile(repoRoot, profile);
    stylePath = path.join(repoRoot, '.agentic-swe', 'style-profile.json');
  } catch {
    /* optional */
  }

  console.log(`Lessons digest written to ${outPath}`);
  console.log(`Total lessons: ${data.total_lessons}`);
  console.log('Categories:', JSON.stringify(data.categories, null, 2));
  if (stylePath) {
    console.log(`Style profile refreshed at ${stylePath}`);
  }
}

module.exports = { parseReflectionLog, classifyFailure, buildLessons, writeLessons };
