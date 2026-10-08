const express = require('express');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (e) => console.error(e.message));

app.get('/health', (req, res) => res.sendStatus(200));

async function withRetry(fn, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

app.get('/db', async (req, res) => {
  try {
    const count = await withRetry(async () => {
      await pool.query('create table if not exists visits(id serial primary key, at timestamptz default now())');
      await pool.query('insert into visits default values');
      const r = await pool.query('select count(*)::int as n from visits');
      return r.rows[0].n;
    });
    res.json({ count });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

app.listen(3000, () => console.log('listening on 3000'));
