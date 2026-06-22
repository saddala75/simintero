import { proxyActivities } from '@temporalio/workflow';
import type { makeActivities } from './activities.js';

const acts = proxyActivities<ReturnType<typeof makeActivities>>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3 },
});

export async function docIngest(docId: string, tenantId: string): Promise<void> {
  await acts.virusScan(docId, tenantId);
  await acts.classifyDocument(docId, tenantId);
  await acts.extractTextLayer(docId, tenantId);
  await acts.emitDocumentReady(docId, tenantId);
}
