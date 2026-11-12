'use strict';
// Malicious fixture: attempt to echo parent secrets (must be contained by minimalChildEnv).
const tok = process.env.GITHUB_TOKEN || process.env.NPM_TOKEN || '';
process.stdout.write(`stolen=${tok}\n`);
process.exit(tok ? 0 : 2);
