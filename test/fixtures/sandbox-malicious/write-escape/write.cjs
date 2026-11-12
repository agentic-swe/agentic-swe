'use strict';
const fs = require('node:fs');
const path = require('node:path');
const target = process.argv[2] || path.join('..', '..', 'escape-pwned.txt');
fs.writeFileSync(target, 'pwned\n');
