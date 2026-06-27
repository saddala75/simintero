package com.simintero.enstellar.interop.attachments;

import ca.uhn.fhir.rest.api.server.RequestDetails;
import org.hl7.fhir.r4.model.Attachment;
import org.hl7.fhir.r4.model.Base64BinaryType;
import org.hl7.fhir.r4.model.DocumentReference;
import org.hl7.fhir.r4.model.OperationOutcome;
import org.hl7.fhir.r4.model.StringType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AttachDocumentOperationTest {

    @Mock AttachmentProcessor processor;
    @InjectMocks AttachDocumentOperation operation;

    private static final String CCDA_B64 = Base64.getEncoder().encodeToString(
        "<?xml version='1.0'?><ClinicalDocument/>".getBytes()
    );

    @Test
    void delegatesToProcessorAndReturnsOutcome() {
        when(processor.process(any())).thenReturn("doc-id-001");

        DocumentReference dr = new DocumentReference();
        DocumentReference.DocumentReferenceContentComponent content =
            new DocumentReference.DocumentReferenceContentComponent();
        Attachment attachment = new Attachment();
        attachment.setContentType("application/xml");
        attachment.setDataElement(new Base64BinaryType(CCDA_B64));
        content.setAttachment(attachment);
        dr.setContent(List.of(content));
        dr.addExtension()
            .setUrl("http://simintero.io/fhir/StructureDefinition/rfai-control-number")
            .setValue(new StringType("RFAI-001"));
        dr.addExtension()
            .setUrl("http://simintero.io/fhir/StructureDefinition/claim-id")
            .setValue(new StringType("CLM-001"));
        dr.addExtension()
            .setUrl("http://simintero.io/fhir/StructureDefinition/tenant-id")
            .setValue(new StringType("tenant-dev"));
        dr.addExtension()
            .setUrl("http://simintero.io/fhir/StructureDefinition/loinc-code")
            .setValue(new StringType("11506-3"));

        OperationOutcome result = operation.attach(dr, mock(RequestDetails.class));
        assertThat(result).isNotNull();
        assertThat(result.getIssue()).hasSize(1);
        assertThat(result.getIssueFirstRep().getSeverity())
            .isEqualTo(OperationOutcome.IssueSeverity.INFORMATION);
        verify(processor).process(any(ParsedAttachment275.class));
    }

    @Test
    void returnsErrorOutcomeWhenNoAttachment() {
        DocumentReference dr = new DocumentReference(); // no content
        OperationOutcome result = operation.attach(dr, mock(RequestDetails.class));
        assertThat(result.getIssueFirstRep().getSeverity())
            .isEqualTo(OperationOutcome.IssueSeverity.ERROR);
        verifyNoInteractions(processor);
    }
}
