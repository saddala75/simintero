package com.simintero.enstellar.interop.pas;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.config.PasConfig;
import com.simintero.enstellar.interop.pas.dto.Actor;
import com.simintero.enstellar.interop.pas.dto.EventEnvelope;
import com.simintero.enstellar.interop.pas.dto.NormalizeResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Component
public class CaseIntakePublisher {

    private static final Logger log = LoggerFactory.getLogger(CaseIntakePublisher.class);
    private static final String SCHEMA_VERSION = "1.0.0";
    private static final String EVENT_TYPE = "case.intake.received";
    private static final String ACTOR_ID = "interop-service";
    private static final String ACTOR_TYPE = "service";

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;
    private final String intakeTopic;

    public CaseIntakePublisher(
        KafkaTemplate<String, String> kafkaTemplate,
        ObjectMapper objectMapper,
        PasConfig config
    ) {
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
        this.intakeTopic = config.kafka().intakeTopic();
    }

    public void publish(NormalizeResponse normalizeResponse) {
        UUID caseId = normalizeResponse.caseId() != null
            ? UUID.fromString(normalizeResponse.caseId())
            : null;

        EventEnvelope envelope = new EventEnvelope(
            UUID.randomUUID(),
            normalizeResponse.tenantId(),
            caseId,
            normalizeResponse.correlationId(),
            EVENT_TYPE,
            Instant.now(),
            new Actor(ACTOR_ID, ACTOR_TYPE),
            Map.of(
                "case_id", normalizeResponse.caseId() != null ? normalizeResponse.caseId() : "",
                "tenant_id", normalizeResponse.tenantId(),
                "correlation_id", normalizeResponse.correlationId(),
                "status", normalizeResponse.status() != null ? normalizeResponse.status() : "intake",
                "lob", normalizeResponse.lob() != null ? normalizeResponse.lob() : "",
                "raw_bundle_key", normalizeResponse.rawBundleKey() != null ? normalizeResponse.rawBundleKey() : ""
            ),
            SCHEMA_VERSION
        );

        String value;
        try {
            value = objectMapper.writeValueAsString(envelope);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize EventEnvelope: " + e.getMessage(), e);
        }

        String key = normalizeResponse.tenantId();

        try {
            SendResult<String, String> result = kafkaTemplate
                .send(intakeTopic, key, value)
                .get(10, TimeUnit.SECONDS);

            log.info(
                "case_intake_published tenant={} case_id={} topic={} partition={} offset={}",
                normalizeResponse.tenantId(),
                normalizeResponse.caseId(),
                intakeTopic,
                result.getRecordMetadata().partition(),
                result.getRecordMetadata().offset()
            );

        } catch (ExecutionException | InterruptedException | TimeoutException e) {
            throw new RuntimeException(
                "Failed to publish case.intake.received to Kafka: " + e.getMessage(), e
            );
        }
    }
}
