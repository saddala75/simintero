import express, { type Express } from 'express';
import pg from 'pg';
import { Connection, Client } from '@temporalio/client';
import { FileObjectStore } from './store/FileObjectStore.js';
import { createMinioObjectStore } from './store/MinioObjectStore.js';
import type { ObjectStore } from './store/ObjectStore.js';
import { createIngestRouter } from './routes/ingest.js';
import { createSpanRouter } from './routes/span.js';
import { createMetadataRouter } from './routes/metadata.js';
import { createRedactRouter } from './routes/redact.js';
import { createRedactionViewRouter } from './routes/redaction-view.js';
import { createListRouter } from './routes/list.js';

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero';
const PORT = Number(process.env['PORT'] ?? 4070);
const TEMPORAL_ADDRESS = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';
const NAMESPACE = process.env['TEMPORAL_NAMESPACE'] ?? 'simintero';
const MINIO_ENDPOINT = process.env['MINIO_ENDPOINT'];

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DB_URL });

  let store: ObjectStore;
  if (MINIO_ENDPOINT) {
    const [host, portStr] = MINIO_ENDPOINT.split(':');
    store = await createMinioObjectStore({
      endPoint: host ?? 'minio', port: Number(portStr ?? 9000),
      useSSL: (process.env['MINIO_SECURE'] ?? 'false') === 'true',
      accessKey: process.env['MINIO_ACCESS_KEY'] ?? 'minioadmin',
      secretKey: process.env['MINIO_SECRET_KEY'] ?? 'minioadmin',
      bucket: process.env['MINIO_BUCKET'] ?? 'simintero-docs',
    });
  } else {
    store = new FileObjectStore(process.env['OBJECT_STORE_DIR'] ?? '/tmp/simintero-docs');
  }

  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const temporalClient = new Client({ connection, namespace: NAMESPACE });

  const app: Express = express();
  app.use(express.json({ limit: '50mb' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use(createIngestRouter(pool, store, temporalClient.workflow));
  app.use(createSpanRouter(pool, store));
  app.use(createMetadataRouter(pool));
  app.use(createListRouter(pool));
  app.use(createRedactRouter(pool, store));
  app.use(createRedactionViewRouter(pool));

  app.listen(PORT, () => console.log(`Document Service listening on :${PORT}`));
}

main().catch((err) => { console.error('Document Service fatal error', err); process.exit(1); });
