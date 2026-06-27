package com.simintero.enstellar.interop.attachments;

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
 *   <li>On {@link AttachmentParseException} log and acknowledge without processing
 *       (malformed EDI cannot be retried).</li>
 *   <li>Always acknowledge — infrastructure retries are handled by the container's
 *       {@code DefaultErrorHandler} (FixedBackOff + DeadLetterPublishingRecoverer).</li>
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
        try {
            ParsedAttachment275 parsed = X12v6020AttachmentParser.parse(record.value());
            String docId = processor.process(parsed);
            log.info("[275-consumer] processed rfaiId={} docId={}", parsed.controlNumber(), docId);
        } catch (AttachmentParseException ex) {
            log.error("[275-consumer] parse failed offset={} error={}", record.offset(), ex.getMessage());
        } catch (Exception ex) {
            log.error("[275-consumer] processing failed offset={} error={}", record.offset(), ex.getMessage());
        } finally {
            ack.acknowledge();
        }
    }
}
