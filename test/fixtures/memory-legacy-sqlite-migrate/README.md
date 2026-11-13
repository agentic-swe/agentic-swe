# Legacy SQLite → node:sqlite migration fixture (AE-030e)

`memory.sqlite` was produced before the node:sqlite cutover (`store_engine`
meta set to the pre-cutover engine id). Used by
`test/node-sqlite-memory-store.test.js` for migration round-trip and rollback
tests. Do not regenerate with `node:sqlite`.
