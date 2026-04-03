'use strict';

/**
 * Minimal visual companion server for agentic-swe design/brainstorm.
 * Serves a static page and a WebSocket at /ws for ping/companion messages.
 * Optional: set BRAINSTORM_WATCH_DIR to a directory; file events are broadcast as JSON { type: 'file-change', ... }.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = __dirname;
const PORT = Number(process.env.BRAINSTORM_PORT || process.argv[2] || 47821);
const HOST = process.env.BRAINSTORM_HOST || '127.0.0.1';

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    const htmlPath = path.join(ROOT, 'public', 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(htmlPath).pipe(res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastJson(obj) {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

let fileWatcher = null;
const watchDir = process.env.BRAINSTORM_WATCH_DIR;
if (watchDir) {
  try {
    const chokidar = require('chokidar');
    const abs = path.resolve(watchDir);
    fileWatcher = chokidar.watch(abs, { ignoreInitial: true });
    fileWatcher.on('all', (event, fp) => {
      broadcastJson({
        type: 'file-change',
        event,
        path: fp,
        t: Date.now(),
      });
    });
    process.stdout.write(`brainstorm-server file-watch ${abs}\n`);
  } catch (e) {
    process.stderr.write(
      `brainstorm-server: BRAINSTORM_WATCH_DIR set but file watch failed (${e.message}). Run npm install in tools/brainstorm-server (needs chokidar).\n`
    );
  }
}

wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      type: 'welcome',
      message: 'agentic-swe brainstorm companion — use with /brainstorm or design phase',
    })
  );
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
      return;
    }
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      return;
    }
    if (msg.type === 'companion') {
      ws.send(
        JSON.stringify({
          type: 'companion-ack',
          echo: msg.message != null ? String(msg.message) : '',
        })
      );
      return;
    }
    ws.send(JSON.stringify({ type: 'error', message: 'unknown message type' }));
  });
});

function shutdown() {
  if (fileWatcher) {
    fileWatcher.close().then(() => {}).catch(() => {});
    fileWatcher = null;
  }
  server.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `brainstorm-server listening http://${HOST}:${PORT} ws://${HOST}:${PORT}/ws\n`
  );
});
