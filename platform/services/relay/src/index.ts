import express, { type Express } from 'express';
import pg from 'pg';
import { KafkaJsProducer } from './KafkaJsProducer.js';
import { relayDb } from './RelayDbPool.js';
import { runRelayLoop } from './loop.js';

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero';
const BROKERS = (process.env['KAFKA_BOOTSTRAP_SERVERS'] ?? 'redpanda:9092').split(',');
const PORT = Number(process.env['PORT'] ?? 3070);
const BATCH = Number(process.env['RELAY_BATCH_SIZE'] ?? 100);
const INTERVAL = Number(process.env['RELAY_INTERVAL_MS'] ?? 500);

const pool = new pg.Pool({ connectionString: DB_URL });
const producer = new KafkaJsProducer(BROKERS);
let stop = false;

const app: Express = express();
app.get('/healthz', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

async function main() {
  await producer.connect();
  app.listen(PORT, () => console.log(`relay listening on :${PORT}`));
  await runRelayLoop({ db: relayDb(pool), producer, batchSize: BATCH, intervalMs: INTERVAL, shouldStop: () => stop });
}

if (process.env['NODE_ENV'] !== 'test') {
  main().catch((e) => { console.error('relay fatal', e); process.exit(1); });
  const shutdown = async () => { stop = true; try { await producer.disconnect(); } catch { /* ignore */ } try { await pool.end(); } catch { /* ignore */ } process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}

export { app };
