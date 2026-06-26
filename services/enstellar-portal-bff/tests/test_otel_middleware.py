"""Test that the OTel enrichment middleware stamps tenant_id and user.sub
from the BFF auth context onto the active span."""
import pytest
from unittest.mock import AsyncMock, MagicMock
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry import trace


@pytest.fixture
def span_exporter():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    yield exporter
    exporter.clear()


@pytest.mark.asyncio
async def test_bff_enrichment_stamps_tenant_and_sub(span_exporter):
    from enstellar_bff.main import otel_enrich

    tracer = trace.get_tracer("test")
    with tracer.start_as_current_span("test-span"):
        request = MagicMock()

        class FakeBffCtx:
            tenant_id = "tenant-bff-001"
            sub = "reviewer-sub-xyz"

        request.state.bff_context = FakeBffCtx()
        call_next = AsyncMock(return_value=MagicMock())
        await otel_enrich(request, call_next)

    finished = span_exporter.get_finished_spans()
    assert finished[0].attributes.get("tenant_id") == "tenant-bff-001"
    assert finished[0].attributes.get("user.sub") == "reviewer-sub-xyz"


@pytest.mark.asyncio
async def test_bff_enrichment_no_context_no_error(span_exporter):
    """Middleware must not raise when bff_context is absent from request.state."""
    from enstellar_bff.main import otel_enrich

    tracer = trace.get_tracer("test")
    with tracer.start_as_current_span("test-span"):
        request = MagicMock()
        del request.state.bff_context
        request.state = MagicMock(spec=[])  # no bff_context attribute
        call_next = AsyncMock(return_value=MagicMock())

        await otel_enrich(request, call_next)  # must not raise
