import express, { type Express } from 'express';
import pg from 'pg';
import { FileObjectStore } from './store/FileObjectStore.js';
import { createIngestRouter } from './routes/ingest.js';
import { createSpanRouter } from './routes/span.js';
import { createMetadataRouter } from './routes/metadata.js';
import { createRedactRouter } from './routes/redact.js';

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero';
const OBJECT_STORE_DIR = process.env['OBJECT_STORE_DIR'] ?? '/tmp/simintero-docs';
const PORT = Number(process.env['PORT'] ?? 4070);

const pool = new pg.Pool({ connectionString: DB_URL });
const store = new FileObjectStore(OBJECT_STORE_DIR);

const app: Express = express();
app.use(express.json({ limit: '50mb' }));
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(createIngestRouter(pool, store));
app.use(createSpanRouter(pool, store));
app.use(createMetadataRouter(pool));
app.use(createRedactRouter());

app.listen(PORT, () => console.log(`Document Service listening on :${PORT}`));
export { app };
