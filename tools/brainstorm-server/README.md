# Brainstorm server (optional)

Local **HTTP + WebSocket** helper for visual or structured brainstorming during the **design** phase (`/brainstorm` command).

## Run

From this directory (after `npm install`):

```bash
npm start
# or: BRAINSTORM_PORT=3001 node server.cjs
```

Open `http://127.0.0.1:47821` (default port). WebSocket endpoint: `ws://127.0.0.1:47821/ws`.

## Protocol (JSON over WebSocket)

| Client `type` | Server response |
|----------------|-----------------|
| `ping` | `{ "type": "pong", "t": <ms> }` |
| `companion` | `{ "type": "companion-ack", "echo": "..." }` |

On connect, server sends `{ "type": "welcome", ... }`.

## Stop

Press `Ctrl+C` in the terminal, or kill the process.

## Security

Binds to **127.0.0.1** by default. Do not expose to the public internet without authentication.
