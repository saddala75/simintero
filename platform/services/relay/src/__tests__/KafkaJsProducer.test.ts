import { describe, it, expect, vi } from 'vitest';
const send = vi.fn(async () => {}); const connect = vi.fn(async () => {}); const disconnect = vi.fn(async () => {});
vi.mock('kafkajs', () => ({ Kafka: vi.fn(() => ({ producer: () => ({ send, connect, disconnect }) })) }));
import { KafkaJsProducer } from '../KafkaJsProducer.js';

describe('KafkaJsProducer', () => {
  it('sends topic/key/value as a kafkajs message', async () => {
    const p = new KafkaJsProducer(['redpanda:9092']);
    await p.connect();
    await p.send('sim.task.lifecycle', 'k1', '{"a":1}');
    expect(connect).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ topic: 'sim.task.lifecycle', messages: [{ key: 'k1', value: '{"a":1}' }] });
  });
});
