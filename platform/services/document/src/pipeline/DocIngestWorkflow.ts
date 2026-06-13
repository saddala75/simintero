import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities.js';

const { virusScan, classifyDocument, extractTextLayer, emitDocumentReady } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '5 minutes',
    retry: { maximumAttempts: 3 },
  });

export async function DocIngestWorkflow(docId: string): Promise<void> {
  await virusScan({} as never, docId);
  await classifyDocument({} as never, docId);
  await extractTextLayer({} as never, docId);
  await emitDocumentReady({} as never, docId);
}
