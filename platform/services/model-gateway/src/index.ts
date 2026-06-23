import express, { type Express } from 'express';
import pg from 'pg';
import { InferenceDispatcher } from './gateway/InferenceDispatcher.js';
import { KillSwitchChecker } from './kill-switch/KillSwitchChecker.js';
import { createInferenceRouter } from './routes/inference.js';
import { createEvalRouter } from './routes/eval.js';
import { createKillSwitchRouter } from './routes/kill-switch.js';
import { createFinopsRouter } from './routes/finops.js';

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero';
const VKAS_URL = process.env['VKAS_URL'] ?? 'http://localhost:4000';
const PORT = Number(process.env['PORT'] ?? 4060);
const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'] ?? '';

const pool = new pg.Pool({ connectionString: DB_URL });
const dispatcher = new InferenceDispatcher(pool, VKAS_URL, ANTHROPIC_API_KEY);
const killSwitchChecker = new KillSwitchChecker(pool);

const app: Express = express();
app.use(express.json());
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(createInferenceRouter(dispatcher));
app.use(createEvalRouter(dispatcher));
app.use(createKillSwitchRouter(pool, killSwitchChecker));
app.use(createFinopsRouter(pool));

app.listen(PORT, () => {
  console.log(`Model Gateway listening on :${PORT}`);
});

export { app };
