"""Integration test: verify the OTel Collector PHI scrubber removes member_ref
from spans before they reach Tempo.

Requires the observability stack to be running:
    docker compose up otel-collector tempo --wait

Run:
    pip install -r infra/otel/tests/requirements.txt
    pytest infra/otel/tests/test_phi_scrubber.py -v
"""
import time
import uuid

import pytest
import requests
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

COLLECTOR_ENDPOINT = "http://localhost:4317"
TEMPO_BASE_URL = "http://localhost:3200"


@pytest.fixture(scope="module")
def tracer():
    resource = Resource(attributes={"service.name": "phi-scrubber-test"})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=COLLECTOR_ENDPOINT, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    yield trace.get_tracer("test")
    provider.shutdown()


def test_member_ref_is_scrubbed_from_spans(tracer):
    """A span with member_ref attribute must not appear in Tempo with that attribute."""
    trace_id = None

    with tracer.start_as_current_span("test-phi-span") as span:
        span.set_attribute("member_ref", "member-phi-test-001")
        span.set_attribute("tenant_id", "test-tenant")
        span.set_attribute("safe_field", "safe-value")
        ctx = span.get_span_context()
        trace_id = format(ctx.trace_id, "032x")

    # Force flush
    trace.get_tracer_provider().force_flush(timeout_millis=5000)

    # Wait for the span to reach Tempo (collector batch timeout is 5s)
    time.sleep(8)

    # Query Tempo for the trace
    resp = requests.get(f"{TEMPO_BASE_URL}/api/traces/{trace_id}", timeout=10)
    assert resp.status_code == 200, f"Tempo returned {resp.status_code}: {resp.text}"

    trace_data = resp.json()
    # Walk all spans and collect all attribute keys
    all_attr_keys = []
    for batch in trace_data.get("batches", []):
        for scope_span in batch.get("scopeSpans", []):
            for span in scope_span.get("spans", []):
                for attr in span.get("attributes", []):
                    all_attr_keys.append(attr.get("key", ""))

    assert "member_ref" not in all_attr_keys, (
        f"PHI attribute 'member_ref' was found in Tempo — scrubber is not working. "
        f"Keys present: {all_attr_keys}"
    )
    assert "safe_field" in all_attr_keys, (
        "Non-PHI attribute 'safe_field' was unexpectedly removed — over-scrubbing"
    )
    assert "tenant_id" in all_attr_keys, (
        "Non-PHI attribute 'tenant_id' was unexpectedly removed"
    )


def test_resolution_is_scrubbed_from_spans(tracer):
    """The 'resolution' PHI field must also be stripped."""
    trace_id = None

    with tracer.start_as_current_span("test-resolution-span") as span:
        span.set_attribute("resolution", "member-has-condition-xyz")
        span.set_attribute("tenant_id", "test-tenant")
        ctx = span.get_span_context()
        trace_id = format(ctx.trace_id, "032x")

    trace.get_tracer_provider().force_flush(timeout_millis=5000)
    time.sleep(8)

    resp = requests.get(f"{TEMPO_BASE_URL}/api/traces/{trace_id}", timeout=10)
    assert resp.status_code == 200

    all_attr_keys = []
    for batch in resp.json().get("batches", []):
        for scope_span in batch.get("scopeSpans", []):
            for span in scope_span.get("spans", []):
                for attr in span.get("attributes", []):
                    all_attr_keys.append(attr.get("key", ""))

    assert "resolution" not in all_attr_keys, (
        f"PHI attribute 'resolution' found in Tempo. Keys present: {all_attr_keys}"
    )
