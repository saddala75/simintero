import { describe, it, expect, beforeAll } from 'vitest'
import { trace, context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'

describe('@sim/otel enrichSpan', () => {
  let exporter: InMemorySpanExporter
  let provider: BasicTracerProvider

  beforeAll(async () => {
    exporter = new InMemorySpanExporter()
    provider = new BasicTracerProvider()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    provider.register({
      contextManager: new AsyncLocalStorageContextManager(),
    })
  })

  it('enrichSpan stamps attributes onto the active span', async () => {
    const { enrichSpan } = await import('../src/index.js')
    const tracer = trace.getTracer('test')
    tracer.startActiveSpan('test-span', (span) => {
      enrichSpan({ tenant_id: 'tenant-001', 'user.sub': 'sub-abc' })
      span.end()
    })

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0].attributes['tenant_id']).toBe('tenant-001')
    expect(spans[0].attributes['user.sub']).toBe('sub-abc')
  })

  it('enrichSpan is a no-op when no active span exists', async () => {
    const { enrichSpan } = await import('../src/index.js')
    // Should not throw outside of a span context
    expect(() => enrichSpan({ tenant_id: 'x' })).not.toThrow()
  })
})
