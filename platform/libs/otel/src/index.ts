import { trace } from '@opentelemetry/api'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'

// Initialize and start the SDK immediately on import.
// OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME are read from env automatically.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  })
  sdk.start()
}

/**
 * Stamps attributes on the currently active span.
 * Call this from request middleware after auth context is populated.
 * Safe to call outside a span context — becomes a no-op.
 */
export function enrichSpan(attrs: Record<string, string>): void {
  const span = trace.getActiveSpan()
  if (!span) return
  for (const [key, value] of Object.entries(attrs)) {
    span.setAttribute(key, value)
  }
}
