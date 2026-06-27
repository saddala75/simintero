package com.simintero.enstellar.interop.attachments;

import io.opentelemetry.api.trace.Span;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

/**
 * Consumes raw X12 EDI strings from the {@code clearinghouse.inbound.275} topic.
 *
 * <p>Processing contract:
 * <ol>
 *   <li>Parse the EDI string with {@link X12v6020AttachmentParser}.</li>
 *   <li>Delegate to {@link AttachmentProcessor} which stores the C-CDA, updates
 *       {@code interop.rfai_correlation}, and notifies the claims service.</li>
 *   <li>On {@link AttachmentParseException}: ack-and-drop — malformed EDI is a
 *       permanent failure that cannot be resolved by retrying.</li>
 *   <li>On any other exception from {@code processor.process()}: rethrow so the
 *       container's {@code DefaultErrorHandler} (FixedBackOff + DeadLetterPublishingRecoverer)
 *       can retry and eventually DLQ the record.</li>
 * </ol>
 */
@Component
public class ClearinghouseInbound275Consumer {

    private static final Logger log = LoggerFactory.getLogger(ClearinghouseInbound275Consumer.class);

    private final AttachmentProcessor processor;

    public ClearinghouseInbound275Consumer(AttachmentProcessor processor) {
        this.processor = processor;
    }

    @KafkaListener(topics = "clearinghouse.inbound.275",
                   containerFactory = "kafkaListenerContainerFactory")
    public void consume(ConsumerRecord<String, String> record, Acknowledgment ack) {
        ParsedAttachment275 parsed;
        try {
            parsed = X12v6020AttachmentParser.parse(record.value());
        } catch (AttachmentParseException ex) {
            // Malformed EDI is a permanent failure — ack-and-drop (no point in retrying).
            log.warn("[275-consumer] parse failure offset={} — dropping message: {}",
                    record.offset(), ex.getMessage());
            ack.acknowledge();
            return;
        }

        Span.current().setAttribute("tenant_id", parsed.tenantId());
        // processor.process() may throw on transient failures (MinIO, DB, claims HTTP).
        // Do NOT catch those here — let the DefaultErrorHandler retry and eventually DLQ.
        String docId = processor.process(parsed);
        log.info("[275-consumer] processed rfaiId={} docId={}", parsed.controlNumber(), docId);
        ack.acknowledge();
    }
}
