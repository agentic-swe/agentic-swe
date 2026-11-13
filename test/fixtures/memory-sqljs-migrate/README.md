# sql.js → node:sqlite migration fixture (AE-030e)

`memory.sqlite` was produced by `sql.js` (`store_engine=sql.js`) before the
dependency was removed. Used by `test/node-sqlite-memory-store.test.js` for
migration round-trip and rollback tests. Do not regenerate with `node:sqlite`.
