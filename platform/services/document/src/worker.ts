import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { NativeConnection, Worker } from '@temporalio/worker';
import { makeActivities } from './pipeline/activities.js';
import { createMinioObjectStore } from './store/MinioObjectStore.js';

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero';
const TEMPORAL_ADDRESS = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';
const NAMESPACE = process.env['TEMPORAL_NAMESPACE'] ?? 'simintero';
const [MHOST, MPORT] = (process.env['MINIO_ENDPOINT'] ?? 'minio:9000').split(':');

async function run(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DB_URL });
  const store = await createMinioObjectStore({
    endPoint: MHOST ?? 'minio', port: Number(MPORT ?? 9000),
    useSSL: (process.env['MINIO_SECURE'] ?? 'false') === 'true',
    accessKey: process.env['MINIO_ACCESS_KEY'] ?? 'minioadmin',
    secretKey: process.env['MINIO_SECRET_KEY'] ?? 'minioadmin',
    bucket: process.env['MINIO_BUCKET'] ?? 'simintero-docs',
  });
  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });
  const worker = await Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue: 'doc-ingest',
    workflowsPath: fileURLToPath(new URL('./pipeline/DocIngestWorkflow.js', import.meta.url)),
    activities: makeActivities({ pool, store, ocrEndpoint: process.env['OCR_ENDPOINT'] ?? '' }),
  });
  console.log(`Document worker polling namespace=${NAMESPACE} taskQueue=doc-ingest`);
  await worker.run();
}

run().catch((err) => { console.error('Document worker fatal error', err); process.exit(1); });
