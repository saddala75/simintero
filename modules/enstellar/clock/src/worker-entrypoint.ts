import { Worker } from '@temporalio/worker';
import * as activities from './activities/index.js';

const taskQueue = process.env['TASK_QUEUE'] ?? 'clock-workflow';

const worker = await Worker.create({
  workflowsPath: new URL('./workflows/ClockWorkflow.js', import.meta.url).pathname,
  activities,
  taskQueue,
});

await worker.run();
