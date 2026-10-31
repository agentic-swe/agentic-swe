'use strict';

const fs = require('fs');
const path = require('path');
const {
  parseReflectionLog,
  classifyFailure,
  buildLessons,
  writeLessons,
} = require('./lib/memory/lessons.cjs');

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
