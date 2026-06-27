package com.simintero.enstellar.interop.attachments;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ClaimsAttachmentRequestedConsumerTest {

    @Mock ClearinghouseRfaiClient rfaiClient;
    @Mock JdbcTemplate jdbc;
    @Mock Acknowledgment ack;

    @InjectMocks ClaimsAttachmentRequestedConsumer consumer;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void sendsRfaiAndRecordsCorrelation() throws Exception {
        String payload = MAPPER.writeValueAsString(Map.of(
            "claim_id", "CLM-001",
            "case_ref", "case-001",
            "loinc_codes", List.of("11506-3"),
            "tenant_id", "tenant-dev"
        ));
        ConsumerRecord<String, String> record = new ConsumerRecord<>(
            "claims.attachment.requested", 0, 0L, "CLM-001", payload);

        consumer.consume(record, ack);

        verify(rfaiClient).sendRfai(any(), eq("CLM-001"), eq("case-001"),
            eq(List.of("11506-3")), eq("tenant-dev"));
        verify(jdbc).update(contains("rfai_correlation"), any(Object[].class));
        verify(ack).acknowledge();
    }

    @Test
    void acknowledgesOnMalformedJson() {
        ConsumerRecord<String, String> record = new ConsumerRecord<>(
            "claims.attachment.requested", 0, 1L, "k", "NOT JSON");
        consumer.consume(record, ack);
        verify(ack).acknowledge();
        verifyNoInteractions(rfaiClient);
    }
}
