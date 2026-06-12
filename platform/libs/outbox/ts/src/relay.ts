export interface KafkaProducer {
  send(topic: string, key: string, value: string): Promise<void>;
}

interface DbClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface RelayDb {
  transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
}

export async function relayBatch(
  db: RelayDb,
  kafka: KafkaProducer,
  batchSize = 100
): Promise<number> {
  return db.transaction(async (client) => {
    const { rows } = await client.query<{
      seq: string;
      topic: string;
      key: string;
      envelope: string;
    }>(
      `SELECT seq, topic, key, envelope
       FROM shared.outbox
       WHERE published_at IS NULL
       ORDER BY seq
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize]
    );

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
