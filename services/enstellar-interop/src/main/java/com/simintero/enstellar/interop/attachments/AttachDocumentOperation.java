package com.simintero.enstellar.interop.attachments;

import ca.uhn.fhir.rest.annotation.Operation;
import ca.uhn.fhir.rest.annotation.ResourceParam;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.server.IResourceProvider;
import org.hl7.fhir.instance.model.api.IBase;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.instance.model.api.IPrimitiveType;
import org.hl7.fhir.r4.model.Attachment;
import org.hl7.fhir.r4.model.DocumentReference;
import org.hl7.fhir.r4.model.Extension;
import org.hl7.fhir.r4.model.OperationOutcome;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Base64;
import java.util.List;
import java.util.Optional;

/**
 * HAPI FHIR operation: POST /fhir/DocumentReference/$attach
 *
 * <p>Receives a {@link DocumentReference} carrying a base64-encoded C-CDA attachment and
 * correlation metadata via extensions, then delegates to {@link AttachmentProcessor}.
 *
 * <p>Extensions expected on the {@link DocumentReference}:
 * <ul>
 *   <li>{@code http://simintero.io/fhir/StructureDefinition/rfai-control-number} — RFAI correlation number</li>
 *   <li>{@code http://simintero.io/fhir/StructureDefinition/claim-id} — payer claim ID</li>
 *   <li>{@code http://simintero.io/fhir/StructureDefinition/tenant-id} — tenant identifier</li>
 *   <li>{@code http://simintero.io/fhir/StructureDefinition/loinc-code} — LOINC code for the document type</li>
 * </ul>
 */
@Component
public class AttachDocumentOperation implements IResourceProvider {

    private static final Logger log = LoggerFactory.getLogger(AttachDocumentOperation.class);

    private static final String EXT_RFAI_CONTROL = "http://simintero.io/fhir/StructureDefinition/rfai-control-number";
    private static final String EXT_CLAIM_ID     = "http://simintero.io/fhir/StructureDefinition/claim-id";
    private static final String EXT_TENANT_ID    = "http://simintero.io/fhir/StructureDefinition/tenant-id";
    private static final String EXT_LOINC        = "http://simintero.io/fhir/StructureDefinition/loinc-code";

    private final AttachmentProcessor processor;

    public AttachDocumentOperation(AttachmentProcessor processor) {
        this.processor = processor;
    }

    @Override
    public Class<? extends IBaseResource> getResourceType() {
        return DocumentReference.class;
    }

    /**
     * Handles {@code POST /fhir/DocumentReference/$attach}.
     *
     * @param docRef  the incoming {@link DocumentReference} with attachment and metadata extensions
     * @param request HAPI request details (tenant resolution, audit, etc.)
     * @return {@link OperationOutcome} with INFORMATION severity on success, ERROR on validation failure
     */
    @Operation(name = "$attach", idempotent = false)
    public OperationOutcome attach(
            @ResourceParam DocumentReference docRef,
            RequestDetails request) {

        // Validate: must have at least one content block with data
        if (docRef.getContent().isEmpty()) {
            return errorOutcome("DocumentReference must contain at least one content attachment");
        }

        Attachment att = docRef.getContentFirstRep().getAttachment();
        byte[] rawBytes = att.getData();
        if (rawBytes == null || rawBytes.length == 0) {
            return errorOutcome("Attachment.data is empty");
        }

        // Extract correlation metadata from extensions
        String controlNumber = stringExt(docRef, EXT_RFAI_CONTROL).orElse("UNKNOWN");
        String claimId       = stringExt(docRef, EXT_CLAIM_ID).orElse("UNKNOWN");
        String tenantId      = stringExt(docRef, EXT_TENANT_ID).orElse("unknown");
        String loincCode     = stringExt(docRef, EXT_LOINC).orElse(null);

        // The attachment data arrives as decoded bytes from HAPI (it decoded base64 from the JSON).
        // Re-encode to base64 so AttachmentProcessor can verify/decode consistently.
        String ccdaBase64 = Base64.getEncoder().encodeToString(rawBytes);

        ParsedAttachment275 parsed = new ParsedAttachment275(
                controlNumber, claimId, tenantId, ccdaBase64, loincCode);

        try {
            String docId = processor.process(parsed);
            log.info("[fhir-attach] processed rfaiId={} claimId={} tenant={} docId={}",
                    controlNumber, claimId, tenantId, docId);
            return infoOutcome("Attachment processed successfully. docId=" + docId);
        } catch (Exception ex) {
            log.error("[fhir-attach] processing failed rfaiId={} error={}", controlNumber, ex.getMessage(), ex);
            return errorOutcome("Processing failed: " + ex.getMessage());
        }
    }

    // ------------------------------------------------------------------ helpers

    /**
     * Extracts a {@link org.hl7.fhir.r4.model.StringType} extension value from the resource.
     * Returns empty Optional if no matching extension is found.
     */
    @SuppressWarnings("unchecked")
    private static Optional<String> stringExt(DocumentReference dr, String url) {
        return dr.getExtension().stream()
                .filter(e -> url.equals(e.getUrl()))
                .map(Extension::getValue)
                .filter(v -> v instanceof IPrimitiveType)
                .map(v -> ((IPrimitiveType<String>) v).getValue())
                .findFirst();
    }

    private static OperationOutcome infoOutcome(String detail) {
        OperationOutcome oo = new OperationOutcome();
        oo.addIssue()
                .setSeverity(OperationOutcome.IssueSeverity.INFORMATION)
                .setCode(OperationOutcome.IssueType.INFORMATIONAL)
                .setDiagnostics(detail);
        return oo;
    }

    private static OperationOutcome errorOutcome(String detail) {
        OperationOutcome oo = new OperationOutcome();
        oo.addIssue()
                .setSeverity(OperationOutcome.IssueSeverity.ERROR)
                .setCode(OperationOutcome.IssueType.INVALID)
                .setDiagnostics(detail);
        return oo;
    }
}
