import express, { type Express } from 'express';
import { createTerminologyRouter } from './router.js';

const VKAS_URL = process.env['VKAS_URL'] ?? 'http://localhost:3040';
const PORT = Number(process.env['PORT'] ?? 3030);

const app: Express = express();
app.use(express.json());
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(createTerminologyRouter(VKAS_URL));

if (process.env['NODE_ENV'] !== 'test') {
  app.listen(PORT, () => console.log(`terminology-service listening on :${PORT}`));
}

export { app };
