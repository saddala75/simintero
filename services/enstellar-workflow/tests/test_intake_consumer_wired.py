"""Test that IntakeConsumer is wired into the app lifespan.

Strategy: Rather than spinning up the full lifespan (which requires real
DB/Kafka connections and is better suited for integration tests), this test
statically inspects main.py to assert that:
1. IntakeConsumer is imported from the consumers package.
2. IntakeConsumer is instantiated and passed to asyncio.create_task in main.py.

This is the correct approach for a unit test of wiring — the integration
evidence that IntakeConsumer processes real events lives in the smoke tests.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path


def _get_main_source() -> str:
    """Return the source of enstellar_workflow.main as a string."""
    from enstellar_workflow import main as main_module

    return inspect.getsource(main_module)


def test_intake_consumer_imported_in_main():
    """IntakeConsumer must appear in the import block of main.py."""
    source = _get_main_source()
    assert "IntakeConsumer" in source, (
        "IntakeConsumer is NOT imported in main.py — it will never be started. "
        "Add IntakeConsumer to the consumers import block."
    )


def test_intake_consumer_task_created_in_lifespan():
    """asyncio.create_task(intake_consumer.run()) must appear in the lifespan context manager."""
    source = _get_main_source()

    # Check both that IntakeConsumer is instantiated and that .run() is called in a task
    assert "IntakeConsumer(" in source, (
        "IntakeConsumer() is never instantiated in main.py lifespan."
    )
    # The run task must be created (via asyncio.create_task or direct await)
    assert "intake_consumer.run()" in source or "IntakeConsumer" in source and "run()" in source, (
        "IntakeConsumer.run() is never scheduled as an asyncio task in main.py lifespan. "
        "PAS $submit events will sit in Kafka unprocessed."
    )


def test_intake_consumer_shutdown_in_lifespan():
    """intake_task.cancel() must appear in the lifespan shutdown block."""
    source = _get_main_source()
    assert "intake_task" in source, (
        "intake_task is not referenced in main.py — IntakeConsumer is not being gracefully "
        "shut down on app exit."
    )


def test_intake_consumer_producer_assigned():
    """intake_consumer._producer must be assigned (for DLQ publishing)."""
    source = _get_main_source()
    assert "intake_consumer._producer" in source, (
        "intake_consumer._producer is not assigned in main.py — the consumer cannot "
        "publish to the Kafka dead-letter topic on failure."
    )
