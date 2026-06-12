import type { RelayDb } from "./types.js";

export interface KafkaProducer {
  send(topic: string, key: string, value: string): Promise<void>;
}

/**
 * Polls shared.outbox for unpublished rows and delivers them to Kafka.
 * Guarantees at-least-once delivery: if kafka.send() fails mid-batch,
 * the transaction rolls back and all rows are redelivered on the next poll.
 * Consumers MUST deduplicate on event_id.
 */
export async function relayBatch(
  // db must be a service/admin connection, NOT a tenant-scoped TenantDb.
  // ctx() inside TenantDb.transaction() would incorrectly scope the outbox SELECT.
  db: RelayDb,
  kafka: KafkaProducer,
  batchSize = 100
): Promise<number> {
  return db.transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT seq, topic, key, envelope
       FROM shared.outbox
       WHERE published_at IS NULL
       ORDER BY seq
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize]
    ) as { rows: { seq: string; topic: string; key: string; envelope: string }[] };

    for (const row of rows) {
      await kafka.send(row.topic, row.key, row.envelope);
      await client.query(
        `UPDATE shared.outbox SET published_at = now() WHERE seq = $1`,
        [row.seq]
      );
    }

    return rows.length;
  });
}
