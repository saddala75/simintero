package com.simintero.enstellar.interop.decision;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.decision.dto.DecisionEventEnvelope;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Kafka listener that consumes decision.recorded events and updates
 * the corresponding DecisionRecord in the decision_store table.
 *
 * Processing contract:
 *   1. Parse EventEnvelope JSON.
 *   2. Validate tenant_id present — discard (log error) if missing (INVARIANT #5).
 *   3. Parse case_id as UUID — discard if malformed.
 *   4. Find DecisionRecord by case_id + tenant_id.
 *   5. Update outcome, rule_artifact, rule_version, auto_approved, decided_at.
 *   6. Save and acknowledge.
 *
 * Safety contract:
 *   - NEVER throws from onDecision() — all exceptions are caught and logged.
 *   - Offset is always acknowledged (to avoid infinite retry on poison-pill events)
 *     EXCEPT when the DB save itself fails — in that case the exception propagates to the
 *     container's DefaultErrorHandler, which retries 3× with 1s backoff before publishing
 *     the record to decision.recorded.DLT.
 *   - Out-of-order events (no matching intake record) are published to decision.recorded.DLT
 *     for manual inspection rather than silently discarded.
 *
 * INVARIANT #3: no PHI is logged — only tenant_id, case_id, correlation_id, event_id.
 */
@Component
public class DecisionEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(DecisionEventConsumer.class);
    private static final String DLT_TOPIC = "decision.recorded.DLT";

    private final DecisionStore decisionStore;
    private final ObjectMapper objectMapper;
    private final KafkaTemplate<String, String> kafkaTemplate;

    public DecisionEventConsumer(DecisionStore decisionStore, ObjectMapper objectMapper,
                                 KafkaTemplate<String, String> kafkaTemplate) {
        this.decisionStore = decisionStore;
        this.objectMapper = objectMapper;
        this.kafkaTemplate = kafkaTemplate;
    }

    @KafkaListener(topics = "decision.recorded", containerFactory = "kafkaListenerContainerFactory")
    public void onDecision(ConsumerRecord<String, String> record, Acknowledgment ack) {
        String rawJson = record.value();

        DecisionEventEnvelope envelope;
        try {
            envelope = objectMapper.readValue(rawJson, DecisionEventEnvelope.class);
        } catch (Exception e) {
            log.error("decision_consumer_parse_error offset={} error={}",
                    record.offset(), e.getMessage());
            ack.acknowledge();
            return;
        }

        // INVARIANT #5: tenant_id must be present
        String tenantId = envelope.tenantId();
        if (tenantId == null || tenantId.isBlank()) {
            log.error("decision_consumer_missing_tenant_id event_id={} — discarding",
                    envelope.eventId());
            ack.acknowledge();
            return;
        }

        String rawCaseId = envelope.caseId();
        if (rawCaseId == null || rawCaseId.isBlank()) {
            log.error("decision_consumer_missing_case_id event_id={} tenant_id={} — discarding",
                    envelope.eventId(), tenantId);
            ack.acknowledge();
            return;
        }

        UUID caseId;
        try {
            caseId = UUID.fromString(rawCaseId);
        } catch (IllegalArgumentException e) {
            log.error("decision_consumer_invalid_case_id event_id={} tenant_id={} case_id={} — discarding",
                    envelope.eventId(), tenantId, rawCaseId);
            ack.acknowledge();
            return;
        }

        if (envelope.payload() == null) {
            log.error("decision_consumer_null_payload event_id={} tenant_id={} — discarding",
                    envelope.eventId(), tenantId);
            ack.acknowledge();
            return;
        }

        log.info("decision_consumer_received event_id={} tenant_id={} case_id={} outcome={}",
                envelope.eventId(), tenantId, caseId, envelope.payload().outcome());

        Optional<DecisionRecord> existing = decisionStore.findByCaseIdAndTenantId(caseId, tenantId);
        if (existing.isEmpty()) {
            log.warn("decision_consumer_no_intake_record event_id={} tenant_id={} case_id={} "
                    + "— no matching DecisionRecord; publishing to DLT for inspection",
                    envelope.eventId(), tenantId, caseId);
            kafkaTemplate.send(DLT_TOPIC, record.key(), rawJson);
            ack.acknowledge();
            return;
        }

        DecisionRecord dr = existing.get();

        // Idempotency guard: if already decided, do not overwrite
        if (dr.getOutcome() != null) {
            log.info("decision_consumer_already_decided event_id={} tenant_id={} case_id={} "
                    + "existing_outcome={} — skipping duplicate",
                    envelope.eventId(), tenantId, caseId, dr.getOutcome());
            ack.acknowledge();
            return;
        }

        dr.setOutcome(envelope.payload().outcome());
        dr.setRuleArtifact(envelope.payload().ruleArtifactId());
        dr.setRuleVersion(envelope.payload().ruleVersion());
        dr.setAutoApproved(envelope.payload().autoApproved());

        Instant decidedAt = parseOccurredAt(envelope.occurredAt());
        dr.setDecidedAt(decidedAt);

        decisionStore.save(dr);

        log.info("decision_consumer_updated event_id={} tenant_id={} case_id={} outcome={} artifact={}@{}",
                envelope.eventId(), tenantId, caseId,
                dr.getOutcome(), dr.getRuleArtifact(), dr.getRuleVersion());

        ack.acknowledge();
    }

    // -----------------------------------------------------------------------

    private Instant parseOccurredAt(String occurredAt) {
        if (occurredAt == null) return Instant.now();
        try {
            return Instant.parse(occurredAt);
        } catch (Exception e) {
            log.warn("decision_consumer_occurred_at_parse_error value={} — using now()", occurredAt);
            return Instant.now();
        }
    }
}
