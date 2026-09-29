// A minimal database interface shared by node-postgres (Neon) and PGlite (tests, local dev):
//   query(text, params) -> { rows }   exec(sql)   tx(async q => ...)
// jsonb values are always passed as JSON strings and cast in SQL, so both drivers agree.

export function pgDb(pool) {
  return {
    query: (text, params) => pool.query(text, params),
    exec: sql => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: (t, p) => client.query(t, p) });
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export function pgliteDb(pg) {
  return {
    query: (text, params) => pg.query(text, params),
    exec: sql => pg.exec(sql),
    tx: fn => pg.transaction(tx => fn({ query: (t, p) => tx.query(t, p) })),
  };
}
