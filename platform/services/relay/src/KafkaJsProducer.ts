import { Kafka, type Producer } from 'kafkajs';
import type { KafkaProducer } from '@sim/outbox-ts/relay';

export class KafkaJsProducer implements KafkaProducer {
  private producer: Producer;
  constructor(brokers: string[]) {
    this.producer = new Kafka({ clientId: 'sim-relay', brokers }).producer({ idempotent: true });
  }
  async connect(): Promise<void> { await this.producer.connect(); }
  async disconnect(): Promise<void> { await this.producer.disconnect(); }
  async send(topic: string, key: string, value: string): Promise<void> {
    await this.producer.send({ topic, messages: [{ key, value }] });
  }
}
