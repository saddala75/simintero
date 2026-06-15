"""aiokafka producer wrapper.

Topics are partitioned by tenant_id so all events for a tenant land in order.
The relay passes the platform EventEnvelope (already serialized to a jsonb dict
in shared.outbox); we publish its canonical JSON bytes.
"""
import json

from aiokafka import AIOKafkaProducer

from ..config import get_settings


class KafkaProducer:
    def __init__(self) -> None:
        settings = get_settings()
        self._producer = AIOKafkaProducer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            enable_idempotence=True,
        )

    async def start(self) -> None:
        await self._producer.start()

    async def stop(self) -> None:
        await self._producer.stop()

    async def send(self, topic: str, envelope: dict, *, key: str | None = None) -> None:
        """Publish a platform EventEnvelope (as a dict) to Kafka.

        Partitioned by ``key`` (the outbox key = correlation_id) when provided,
        else by the envelope's tenant_id.
        """
        value = json.dumps(envelope).encode("utf-8")
        if key is None:
            key = envelope.get("tenant", {}).get("tenant_id", "")
        await self._producer.send_and_wait(topic, value=value, key=key.encode("utf-8"))
