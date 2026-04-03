# Brainstorm server (optional)

Local **HTTP + WebSocket** helper for visual or structured brainstorming during the **design** phase (`/brainstorm` command).

## Install (once)

From **`tools/brainstorm-server/`** (recommended — keeps `ws` + `chokidar` together):

```bash
cd tools/brainstorm-server && npm install
```

CI and contributors: the repo root `npm test` flow runs `npm install --prefix tools/brainstorm-server` so integration tests can start this server. You do **not** need a separate `ws` install at the repo root for the brainstorm server.

## Run

```bash
npm start
# or: BRAINSTORM_PORT=3001 node server.cjs
```

Open `http://127.0.0.1:47821` (default port). WebSocket endpoint: `ws://127.0.0.1:47821/ws`.

### Optional file watch

Set **`BRAINSTORM_WATCH_DIR`** to an absolute or relative directory. When `chokidar` is installed, the server watches that tree and broadcasts to all WS clients:

```json
{ "type": "file-change", "event": "add", "path": "/full/path/to/file", "t": 1234567890 }
```

Use for live companion UIs when design artifacts or source files change.

## Protocol (JSON over WebSocket)

| Client `type` | Server response |
|----------------|-----------------|
| `ping` | `{ "type": "pong", "t": <ms> }` |
| `companion` | `{ "type": "companion-ack", "echo": "..." }` |

Server may also push `file-change` (see above). On connect, server sends `{ "type": "welcome", ... }`.

## Stop

Press `Ctrl+C` in the terminal, or kill the process.

## Security

Binds to **127.0.0.1** by default. Do not expose to the public internet without authentication.
