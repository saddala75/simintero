// services/qualitron-aggregation/src/server.ts
import '@sim/otel'
import { Kafka } from 'kafkajs'
import pg from 'pg'
import express from 'express'
import { handleEvidenceIndexed, scheduleDailyBatch } from '@sim/qualitron-aggregation'

const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] })

const kafka = new Kafka({
  clientId: 'qualitron-aggregation',
  brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
})

async function startConsumer() {
  const consumer = kafka.consumer({ groupId: 'qualitron-aggregation-evidence' })
  await consumer.connect()
  await consumer.subscribe({ topic: 'sim.qual.evidence', fromBeginning: false })

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return
      try {
        const envelope = JSON.parse(message.value.toString()) as {
          tenant?: { tenant_id?: string }
          payload?: { event_type?: string }
        }
        const tenantId = envelope.tenant?.tenant_id
        if (!tenantId) return
        const payload = envelope.payload
        if (payload?.event_type !== 'EvidenceIndexed') return
        await handleEvidenceIndexed(
          payload as Parameters<typeof handleEvidenceIndexed>[0],
          tenantId,
          pool,
        )
      } catch (err) {
        console.error('qualitron-aggregation consumer error:', err)
        // Swallow — we don't want to crash the consumer on bad messages
      }
    },
  })
}

// Health check HTTP server
const app = express()
app.get('/health', (_req, res) => res.json({ ok: true }))
const port = parseInt(process.env['PORT'] ?? '4081', 10)
app.listen(port, () =>
  console.log(`qualitron-aggregation health endpoint listening on ${port}`),
)

// Start Kafka consumer
startConsumer().catch(err => {
  console.error('Failed to start aggregation consumer:', err)
  process.exit(1)
})

// Schedule nightly batch runs
scheduleDailyBatch(pool)
console.log('qualitron-aggregation started')
