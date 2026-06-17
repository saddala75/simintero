import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities/index.js';

const TEMPORAL_ADDRESS = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';
const NAMESPACE = process.env['TEMPORAL_NAMESPACE'] ?? 'simintero';
const TASK_QUEUE = 'revital';

async function run(): Promise<void> {
  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });
  const worker = await Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL('./workflows/RevitalAnalyzeCase.js', import.meta.url)),
    activities,
  });
  console.log(`Revital worker polling namespace=${NAMESPACE} taskQueue=${TASK_QUEUE}`);
  await worker.run();
}

run().catch((err) => {
  console.error('Revital worker fatal error', err);
  process.exit(1);
});
