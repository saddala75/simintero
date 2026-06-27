package com.simintero.enstellar.interop.attachments;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ClearinghouseInbound275ConsumerTest {

    @Mock AttachmentProcessor processor;
    @Mock Acknowledgment ack;

    @InjectMocks ClearinghouseInbound275Consumer consumer;

    private static final String SAMPLE_275 = """
            ISA*00*          *00*          *ZZ*PROVIDER*ZZ*SIM*260101*1200*^*00601*CTRL001*0*P*:
            ST*275*0001
            BGN*11*CTRL001*20260101*1200
            TRN*1*RFAI-001
            REF*EJ*CLM-001
            REF*SIM*tenant-dev
            PWK*01*EL*11506-3
            BIN*10*PD94bWwgdmVyc2lvbj0iMS4wIj8+
            SE*8*0001
            IEA*1*CTRL001
            """;

    @Test
    void delegatesToProcessorAndAcknowledges() {
        when(processor.process(any())).thenReturn("doc-id-1");
        ConsumerRecord<String, String> record = new ConsumerRecord<>(
            "clearinghouse.inbound.275", 0, 0L, "k", SAMPLE_275);

        consumer.consume(record, ack);

        verify(processor).process(any(ParsedAttachment275.class));
        verify(ack).acknowledge();
    }

    @Test
    void acknowledgesOnParseException() {
        ConsumerRecord<String, String> record = new ConsumerRecord<>(
            "clearinghouse.inbound.275", 0, 1L, "k", "INVALID EDI");

        consumer.consume(record, ack);

        verify(ack).acknowledge();
        verifyNoInteractions(processor);
    }
}
