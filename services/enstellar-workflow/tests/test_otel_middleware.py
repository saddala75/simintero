"""Test that the OTel enrichment middleware stamps tenant_id and user.sub
onto the active span from the request auth context."""
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
async def test_enrichment_middleware_stamps_tenant_and_sub(span_exporter):
    """The otel_enrich middleware reads tenant_context from request.state
    and stamps tenant_id + user.sub onto the active span."""
    from enstellar_workflow.main import otel_enrich

    tracer = trace.get_tracer("test")
    with tracer.start_as_current_span("test-span"):
        request = MagicMock()

        class FakeTenantCtx:
            tenant_id = "tenant-test-001"
            sub = "user-sub-abc"

        request.state.tenant_context = FakeTenantCtx()
        call_next = AsyncMock(return_value=MagicMock())

        await otel_enrich(request, call_next)

    finished = span_exporter.get_finished_spans()
    assert len(finished) == 1
    assert finished[0].attributes.get("tenant_id") == "tenant-test-001"
    assert finished[0].attributes.get("user.sub") == "user-sub-abc"


@pytest.mark.asyncio
async def test_enrichment_middleware_no_context_no_error(span_exporter):
    """Middleware must not raise when tenant_context is absent from request.state."""
    from enstellar_workflow.main import otel_enrich

    tracer = trace.get_tracer("test")
    with tracer.start_as_current_span("test-span"):
        request = MagicMock()
        del request.state.tenant_context
        request.state = MagicMock(spec=[])  # no tenant_context attribute
        call_next = AsyncMock(return_value=MagicMock())

        await otel_enrich(request, call_next)  # must not raise
