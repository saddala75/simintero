package com.simintero.enstellar.interop.document;

import ca.uhn.fhir.context.FhirContext;
import org.hl7.fhir.r4.model.Binary;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.DocumentReference;
import org.hl7.fhir.r4.model.QuestionnaireResponse;
import org.hl7.fhir.r4.model.Resource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Extracts ingestable documents from a PAS bundle and pushes them to the Document Service,
 * keyed by {@code case_ref = correlationId}. Ingestion is best-effort: any failure is logged
 * and swallowed so it can never fail the {@code $submit} (documents are not needed for the
 * QUEUED ack). Ingestable resources:
 *   Binary                -> channel fhir_binary             (the binary's raw bytes)
 *   DocumentReference     -> channel fhir_document_reference (the resource JSON)
 *   QuestionnaireResponse -> channel fhir_document_reference (the resource JSON)
 */
@Component
public class PasDocumentIngestor {

    private static final Logger log = LoggerFactory.getLogger(PasDocumentIngestor.class);

    private final DocumentServiceClient client;
    private final FhirContext fhirContext;

    public PasDocumentIngestor(DocumentServiceClient client, FhirContext fhirContext) {
        this.client = client;
        this.fhirContext = fhirContext;
    }

    public void ingest(Bundle bundle, String correlationId, String tenantId) {
        if (bundle == null) {
            return;
        }
        for (Bundle.BundleEntryComponent entry : bundle.getEntry()) {
            Resource resource = entry.getResource();
            if (resource instanceof Binary binary) {
                ingestOne("fhir_binary", encodeBinary(binary), correlationId, tenantId, "Binary");
            } else if (resource instanceof DocumentReference docRef) {
                ingestOne("fhir_document_reference", encodeResourceJson(docRef), correlationId, tenantId,
                        "DocumentReference");
            } else if (resource instanceof QuestionnaireResponse qr) {
                ingestOne("fhir_document_reference", encodeResourceJson(qr), correlationId, tenantId,
                        "QuestionnaireResponse");
            }
        }
    }

    private void ingestOne(String channel, String base64Payload, String correlationId, String tenantId,
                           String resourceType) {
        try {
            client.ingest(channel, base64Payload, correlationId, tenantId);
            log.info("pas_document_ingested tenant={} correlation_id={} resource_type={} channel={}",
                    tenantId, correlationId, resourceType, channel);
        } catch (RuntimeException e) {
            log.warn("pas_document_ingest_failed tenant={} correlation_id={} resource_type={} error={}",
                    tenantId, correlationId, resourceType, e.toString());
        }
    }

    /** Binary already carries base64 data on the wire; getData() returns the decoded bytes — re-encode. */
    private String encodeBinary(Binary binary) {
        byte[] data = binary.hasData() ? binary.getData() : new byte[0];
        return Base64.getEncoder().encodeToString(data);
    }

    private String encodeResourceJson(Resource resource) {
        String json = fhirContext.newJsonParser().setPrettyPrint(false).encodeResourceToString(resource);
        return Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }
}
