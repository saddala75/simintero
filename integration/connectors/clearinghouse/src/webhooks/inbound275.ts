import express from 'express';

interface KafkaProducer {
  send(args: { topic: string; messages: Array<{ key?: string; value: string }> }): Promise<void>;
}

export function createInbound275Router(producer: KafkaProducer): express.Router {
  const router = express.Router();

  router.post('/275', async (req, res) => {
    const body = req.body as string;
    if (!body || body.trim().length === 0) {
      return res.status(400).json({ error: 'Body is required' });
    }

    const tenantId = (req.headers['x-sim-tenant-id'] as string | undefined) ?? 'unknown';

    try {
      await producer.send({
        topic: 'clearinghouse.inbound.275',
        messages: [{ key: tenantId, value: body }],
      });
      return res.status(200).json({ queued: true });
    } catch (err) {
      console.error('[inbound275] kafka send failed', err);
      return res.status(500).json({ error: 'Failed to queue message' });
    }
  });

  return router;
}
