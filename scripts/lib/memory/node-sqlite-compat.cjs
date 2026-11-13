'use strict';

/**
 * AE-030e — thin row/statement facade over node:sqlite DatabaseSync.
 * Existing graph-store callers keep stmt.run([...]) / step / getAsObject / exec shapes.
 * Refs ADR-004b A1 / ADR-016.
 */

/**
 * @param {string} sql
 * @returns {string[]}
 */
function splitStatements(sql) {
  const parts = [];
  let cur = '';
  let inSingle = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" && !inSingle) {
      inSingle = true;
      cur += ch;
      continue;
    }
    if (ch === "'" && inSingle) {
      // SQLite escape: ''
      if (sql[i + 1] === "'") {
        cur += "''";
        i += 1;
        continue;
      }
      inSingle = false;
      cur += ch;
      continue;
    }
    if (ch === ';' && !inSingle) {
      const t = cur.trim();
      if (t) parts.push(t);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * @param {string} sql
 */
function returnsRows(sql) {
  return /^(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql.trim());
}

/**
 * @param {import('node:sqlite').DatabaseSync} nativeDb
 */
function wrapDatabase(nativeDb) {
  /**
   * @param {string} sql
   * @param {unknown[]|Record<string, unknown>|undefined} [params]
   */
  function run(sql, params) {
    if (params !== undefined) {
      const list = Array.isArray(params) ? params : [params];
      nativeDb.prepare(sql).run(...list);
      return;
    }
    nativeDb.exec(sql);
  }

  /**
   * Compat shape: [{ columns, values }] for row-returning statements.
   * @param {string} sql
   */
  function exec(sql) {
    const results = [];
    for (const part of splitStatements(sql)) {
      if (returnsRows(part)) {
        const stmt = nativeDb.prepare(part);
        const cols = stmt.columns().map((c) => c.name);
        const rows = stmt.all();
        const values = rows.map((row) => cols.map((name) => row[name]));
        results.push({ columns: cols, values });
      } else {
        nativeDb.exec(part);
      }
    }
    return results;
  }

  /**
   * @param {string} sql
   */
  function prepare(sql) {
    const nativeStmt = nativeDb.prepare(sql);
    /** @type {unknown[]} */
    let bound = [];
    /** @type {Iterator<Record<string, unknown>> | null} */
    let iter = null;
    /** @type {Record<string, unknown> | null} */
    let current = null;
    let consumed = false;

    function asList(params) {
      if (params === undefined || params === null) return bound.slice();
      if (Array.isArray(params)) return params.slice();
      return [params];
    }

    return {
      /**
       * @param {unknown[]|Record<string, unknown>|undefined} [params]
       */
      bind(params) {
        bound = asList(params);
        iter = null;
        current = null;
        consumed = false;
      },

      /**
       * @param {unknown[]|Record<string, unknown>|undefined} [params]
       */
      run(params) {
        const list = asList(params);
        nativeStmt.run(...list);
        iter = null;
        current = null;
        consumed = false;
      },

      step() {
        if (!iter) {
          iter = nativeStmt.iterate(...bound);
          consumed = false;
        }
        const next = iter.next();
        if (next.done) {
          current = null;
          consumed = true;
          return false;
        }
        current = /** @type {Record<string, unknown>} */ (next.value);
        return true;
      },

      getAsObject() {
        if (!current) return {};
        // Materialize a plain object (callers mutate / JSON.stringify).
        return { ...current };
      },

      free() {
        iter = null;
        current = null;
        bound = [];
        consumed = false;
        void consumed;
      },
    };
  }

  return {
    run,
    exec,
    prepare,
    close() {
      try {
        nativeDb.close();
      } catch {
        /* ignore */
      }
    },
    /** @deprecated no whole-file export under node:sqlite (ADR-004b) */
    export() {
      const err = new Error('db.export() is unsupported under node:sqlite (ADR-004b)');
      err.code = 'STORE_EXPORT_UNSUPPORTED';
      throw err;
    },
    /** @type {import('node:sqlite').DatabaseSync} */
    _native: nativeDb,
  };
}

module.exports = {
  wrapDatabase,
  splitStatements,
  returnsRows,
};
