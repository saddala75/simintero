package com.simintero.enstellar.interop.attachments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Consumes {@code claims.attachment.requested} events published by the outbox.
 *
 * <p>Processing contract:
 * <ol>
 *   <li>Deserialize JSON payload — ack and log on parse failure (poison-pill guard).</li>
 *   <li>Generate a unique RFAI identifier and persist a correlation row BEFORE sending,
 *       so the inbound 275 consumer can resolve it immediately on receipt.</li>
 *   <li>POST a 277-RFAI to the clearinghouse adapter via {@link ClearinghouseRfaiClient}.</li>
 *   <li>Always acknowledge — application-layer retries are disabled; the container's
 *       {@code DefaultErrorHandler} (FixedBackOff + DeadLetterPublishingRecoverer) handles
 *       transient infrastructure failures.</li>
 * </ol>
 */
@Component
public class ClaimsAttachmentRequestedConsumer {

    private static final Logger log = LoggerFactory.getLogger(ClaimsAttachmentRequestedConsumer.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ClearinghouseRfaiClient rfaiClient;
    private final JdbcTemplate jdbc;

    public ClaimsAttachmentRequestedConsumer(ClearinghouseRfaiClient rfaiClient, JdbcTemplate jdbc) {
        this.rfaiClient = rfaiClient;
        this.jdbc = jdbc;
    }

    @KafkaListener(topics = "claims.attachment.requested",
                   containerFactory = "kafkaListenerContainerFactory")
    public void consume(ConsumerRecord<String, String> record, Acknowledgment ack) {
        try {
            JsonNode payload = MAPPER.readTree(record.value());
            String claimId  = payload.path("claim_id").asText();
            String caseRef  = payload.path("case_ref").asText();
            String tenantId = payload.path("tenant_id").asText("unknown");

            List<String> loincCodes = new ArrayList<>();
            payload.path("loinc_codes").forEach(n -> loincCodes.add(n.asText()));

            String rfaiId = "RFAI-" + UUID.randomUUID().toString()
                    .replace("-", "").substring(0, 12).toUpperCase();

            // Persist correlation BEFORE sending so the 275 consumer can resolve immediately
            jdbc.update(
                "INSERT INTO interop.rfai_correlation (rfai_id, claim_id, tenant_id, case_ref, loinc_codes) "
                    + "VALUES (?, ?, ?, ?, ?::text[])",
                rfaiId, claimId, tenantId, caseRef, loincCodes.toArray(String[]::new)
            );

            rfaiClient.sendRfai(rfaiId, claimId, caseRef, loincCodes, tenantId);
            log.info("[rfai-consumer] sent rfaiId={} claimId={} tenant={}", rfaiId, claimId, tenantId);
        } catch (Exception ex) {
            log.error("[rfai-consumer] failed offset={} error={}", record.offset(), ex.getMessage());
        } finally {
            ack.acknowledge();
        }
    }
}
