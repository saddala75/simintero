import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { createInbound275Router } from '../inbound275.js';

function makeProducer() {
  return { send: vi.fn().mockResolvedValue(undefined) } as any;
}

function makeApp(producer: ReturnType<typeof makeProducer>) {
  const app = express();
  app.use(express.text({ type: ['application/x12', 'text/plain', '*/*'] }));
  app.use('/webhooks', createInbound275Router(producer));
  return app;
}

const SAMPLE_275 = `ISA*00*          *00*          *ZZ*PROVIDER*ZZ*SIM*260101*1200*^*00601*CTRL001*0*P*:\nST*275*0001\nIEA*1*CTRL001\n`;

describe('POST /webhooks/275', () => {
  it('returns 200 and publishes to kafka', async () => {
    const producer = makeProducer();
    const res = await supertest(makeApp(producer))
      .post('/webhooks/275')
      .set('Content-Type', 'application/x12')
      .set('X-Sim-Tenant-Id', 'tenant-dev')
      .send(SAMPLE_275);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queued: true });
    expect(producer.send).toHaveBeenCalledWith({
      topic: 'clearinghouse.inbound.275',
      messages: [expect.objectContaining({ value: SAMPLE_275 })],
    });
  });

  it('returns 400 when body is empty', async () => {
    const producer = makeProducer();
    const res = await supertest(makeApp(producer))
      .post('/webhooks/275')
      .set('Content-Type', 'application/x12')
      .send('');
    expect(res.status).toBe(400);
    expect(producer.send).not.toHaveBeenCalled();
  });

  it('includes tenant header as kafka message key', async () => {
    const producer = makeProducer();
    await supertest(makeApp(producer))
      .post('/webhooks/275')
      .set('Content-Type', 'application/x12')
      .set('X-Sim-Tenant-Id', 'tenant-abc')
      .send(SAMPLE_275);
    expect(producer.send).toHaveBeenCalledWith({
      topic: 'clearinghouse.inbound.275',
      messages: [expect.objectContaining({ key: 'tenant-abc' })],
    });
  });
});
