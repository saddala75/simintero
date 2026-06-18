import express, { type Express } from 'express';
import pg from 'pg';
import { createVkasRouter } from './router.js';

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero';
const PORT = Number(process.env['PORT'] ?? 3040);

const pool = new pg.Pool({ connectionString: DB_URL });

const app: Express = express();
app.use(express.json());
app.locals['pool'] = pool;
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(createVkasRouter());

app.listen(PORT, () => console.log(`VKAS listening on :${PORT}`));

export { app };
