"""aiokafka producer wrapper.

Topics are partitioned by tenant_id so all events for a tenant land in order.
"""
from aiokafka import AIOKafkaProducer

from enstellar_events import EventEnvelope, encode
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

    async def send(self, topic: str, event: EventEnvelope) -> None:
        """Publish an event to Kafka, partitioned by tenant_id."""
        value = encode(event)
        key = event.tenant_id.encode("utf-8")
        await self._producer.send_and_wait(topic, value=value, key=key)
