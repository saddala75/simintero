package com.simintero.enstellar.interop.document;

import ca.uhn.fhir.context.FhirContext;
import org.hl7.fhir.r4.model.Binary;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.QuestionnaireResponse;
import org.junit.jupiter.api.Test;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PasDocumentIngestorTest {

    private final FhirContext fhirContext = FhirContext.forR4();

    private Bundle bundleWith(org.hl7.fhir.r4.model.Resource... resources) {
        Bundle b = new Bundle();
        b.setType(Bundle.BundleType.COLLECTION);
        for (org.hl7.fhir.r4.model.Resource r : resources) {
            b.addEntry().setResource(r);
        }
        return b;
    }

    @Test
    void ingests_binary_and_questionnaire_response_with_correlation_id_as_case_ref() {
        DocumentServiceClient client = mock(DocumentServiceClient.class);
        PasDocumentIngestor ingestor = new PasDocumentIngestor(client, fhirContext);

        Binary binary = new Binary();
        binary.setContentType("application/pdf");
        binary.setData("hello".getBytes());

        QuestionnaireResponse qr = new QuestionnaireResponse();
        qr.setStatus(QuestionnaireResponse.QuestionnaireResponseStatus.COMPLETED);

        ingestor.ingest(bundleWith(binary, qr, new Claim()), "corr-9", "t_test");

        verify(client).ingest(eq("fhir_binary"), anyString(), eq("corr-9"), eq("t_test"));
        verify(client).ingest(eq("fhir_document_reference"), anyString(), eq("corr-9"), eq("t_test"));
        verifyNoMoreInteractions(client);
    }

    @Test
    void makes_no_ingest_call_when_no_ingestable_resources() {
        DocumentServiceClient client = mock(DocumentServiceClient.class);
        PasDocumentIngestor ingestor = new PasDocumentIngestor(client, fhirContext);

        ingestor.ingest(bundleWith(new Claim()), "corr-9", "t_test");

        verifyNoInteractions(client);
    }

    @Test
    void swallows_client_errors_so_submit_is_never_failed() {
        DocumentServiceClient client = mock(DocumentServiceClient.class);
        when(client.ingest(anyString(), anyString(), anyString(), anyString()))
                .thenThrow(new RuntimeException("document-service down"));
        PasDocumentIngestor ingestor = new PasDocumentIngestor(client, fhirContext);

        Binary binary = new Binary();
        binary.setData("x".getBytes());

        // Must not throw.
        ingestor.ingest(bundleWith(binary), "corr-9", "t_test");

        verify(client).ingest(eq("fhir_binary"), anyString(), eq("corr-9"), eq("t_test"));
    }
}
