/**
 * Temporal worker — registers workflows and activities.
 * Run with: node --loader ts-node/esm src/temporal/worker.ts
 */
import { Worker } from '@temporalio/worker';
import * as activities from '../activities/index.js';

export async function createWorker(taskQueue: string): Promise<Worker> {
  return Worker.create({
    workflowsPath: new URL('../workflows/PaWorkflow.js', import.meta.url).pathname,
    activities,
    taskQueue,
  });
}

// If run directly, start the worker
if (import.meta.url === `file://${process.argv[1]}`) {
  const taskQueue = process.env['TASK_QUEUE'] ?? 'pa-workflow';
  const worker = await createWorker(taskQueue);
  await worker.run();
}
