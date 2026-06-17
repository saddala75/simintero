import express, { type Express } from 'express';
import pg from 'pg';
import { createRunsRouter } from './routes/runs.js';

export function buildApp(pool: pg.Pool): Express {
  const app = express();
  app.use(express.json());
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use(createRunsRouter(pool));
  return app;
}

const pool = new pg.Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero',
});
const PORT = Number(process.env['PORT'] ?? 3015);

buildApp(pool).listen(PORT, () => console.log(`qualitron-execution listening on :${PORT}`));
