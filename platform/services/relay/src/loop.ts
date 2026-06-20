import { relayBatch as defaultRelayBatch, type KafkaProducer } from '@sim/outbox-ts/relay';
import type { RelayDb } from '@sim/outbox-ts';

export async function relayTick(args: {
  db: RelayDb; producer: KafkaProducer; batchSize: number;
  relayBatch?: typeof defaultRelayBatch;
}): Promise<number> {
  const fn = args.relayBatch ?? defaultRelayBatch;
  return fn(args.db, args.producer, args.batchSize);
}

export async function runRelayLoop(args: {
  db: RelayDb; producer: KafkaProducer; batchSize: number; intervalMs: number;
  shouldStop: () => boolean;
}): Promise<void> {
  while (!args.shouldStop()) {
    const n = await relayTick(args);
    if (n < args.batchSize) await new Promise((r) => setTimeout(r, args.intervalMs));
  }
}
