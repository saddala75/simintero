package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.rest.annotation.Operation;
import ca.uhn.fhir.rest.annotation.OperationParam;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException;
import com.simintero.enstellar.interop.decision.DecisionRecord;
import io.simintero.tenant.TenantContextHolder;
import com.simintero.enstellar.interop.decision.DecisionStore;
import com.simintero.enstellar.interop.pas.dto.NormalizeResponse;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Identifier;
import org.hl7.fhir.r4.model.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Date;
import java.util.UUID;

@Component
public class PasClaimSubmitProvider implements IResourceProvider {

    private static final Logger log = LoggerFactory.getLogger(PasClaimSubmitProvider.class);

    private final MinioRawBundleStore minioStore;
    private final PasBundleValidator validator;
    private final NormalizationClient normClient;
    private final CaseIntakePublisher intakePublisher;
    private final DecisionStore decisionStore;

    public PasClaimSubmitProvider(
        MinioRawBundleStore minioStore,
        PasBundleValidator validator,
        NormalizationClient normClient,
        CaseIntakePublisher intakePublisher,
        DecisionStore decisionStore
    ) {
        this.minioStore = minioStore;
        this.validator = validator;
        this.normClient = normClient;
        this.intakePublisher = intakePublisher;
        this.decisionStore = decisionStore;
    }

    @Override
    public Class<? extends IBaseResource> getResourceType() {
        return Claim.class;
    }

    @Operation(name = "$submit", idempotent = false, type = Claim.class)
    public Bundle submit(
        @OperationParam(name = "resource") Bundle bundle
    ) {
        String tenantId = TenantContextHolder.get().tenantId();

        String correlationId = (bundle != null && bundle.hasId() && !bundle.getIdElement().getIdPart().isBlank())
            ? bundle.getIdElement().getIdPart()
            : UUID.randomUUID().toString();

        log.info("pas_submit_received tenant={} correlation_id={}", tenantId, correlationId);

        // STEP 1: Store raw bundle FIRST (invariant: store-first-transform-second)
        String rawKey = minioStore.store(tenantId, correlationId, bundle);

        // STEP 2: Validate PAS profile requirements
        validator.validate(bundle);

        // STEP 3: Normalize to canonical Case
        NormalizeResponse normalizeResponse = normClient.normalize(bundle, tenantId, correlationId);

        // STEP 4: Create intake-phase DecisionRecord (outcome=null = pending).
        // DB write before Kafka publish: if the publish fails the case is durably stored
        // and can be recovered; the reverse ordering risks permanent loss if DB fails after publish.
        Claim claim = extractClaim(bundle);
        String claimRef = extractClaimRef(claim, correlationId);
        DecisionRecord trackingRecord = new DecisionRecord();
        trackingRecord.setCaseId(normalizeResponse.caseId() != null
                ? UUID.fromString(normalizeResponse.caseId()) : null);
        trackingRecord.setTenantId(tenantId);
        trackingRecord.setCorrelationId(correlationId);
        trackingRecord.setClaimRef(claimRef);
        trackingRecord.setPatientRef(claim.hasPatient() ? claim.getPatient().getReference() : null);
        trackingRecord.setInsurerRef(claim.hasInsurer() ? claim.getInsurer().getReference() : null);
        trackingRecord.setClaimFhirId(claim.hasId() ? claim.getIdElement().getIdPart() : null);

        try {
            decisionStore.save(trackingRecord);
        } catch (DataIntegrityViolationException e) {
            // Duplicate $submit (same correlationId): return 422 so EHRs don't retry blindly.
            throw new UnprocessableEntityException(
                    "A prior authorization request already exists for correlation_id=" + correlationId);
        }

        log.info("pas_submit_tracking_record_created tenant={} correlation_id={} claim_ref={}",
                tenantId, correlationId, claimRef);

        // STEP 5: Publish case.intake.received event (after durable DB write)
        intakePublisher.publish(normalizeResponse);

        // STEP 6: Return QUEUED ClaimResponse — decision is async via workflow-engine.
        // EHRs poll GET /fhir/Claim/{correlationId}/$inquire for the final outcome.
        Bundle responseBundle = buildQueuedResponseBundle(normalizeResponse, claim, rawKey);

        log.info("pas_submit_complete tenant={} correlation_id={} case_id={}",
            tenantId, correlationId, normalizeResponse.caseId());

        return responseBundle;
    }

    private Bundle buildQueuedResponseBundle(
        NormalizeResponse normalizeResponse,
        Claim claim,
        String rawKey
    ) {
        ClaimResponse response = new ClaimResponse();
        response.setId(UUID.randomUUID().toString());
        response.setStatus(ClaimResponse.ClaimResponseStatus.ACTIVE);
        response.setOutcome(ClaimResponse.RemittanceOutcome.QUEUED);
        response.setUse(ClaimResponse.Use.PREAUTHORIZATION);
        response.setCreated(Date.from(Instant.now()));

        if (claim.hasPatient()) {
            response.setPatient(claim.getPatient());
        }

        String claimIdPart = claim.getIdElement().getIdPart();
        if (claimIdPart != null && !claimIdPart.isBlank()) {
            response.setRequest(new Reference("Claim/" + claimIdPart));
        }

        if (claim.hasInsurer()) {
            response.setInsurer(claim.getInsurer());
        }

        for (Claim.ItemComponent item : claim.getItem()) {
            response.addItem()
                .setItemSequence(item.getSequence())
                .addAdjudication()
                    .setCategory(new CodeableConcept(
                        new Coding()
                            .setSystem("http://terminology.hl7.org/CodeSystem/adjudication")
                            .setCode("submitted")
                            .setDisplay("Submitted Amount")
                    ));
        }

        response.addExtension(
            "https://enstellar.simintero.com/fhir/StructureDefinition/raw-bundle-key",
            new org.hl7.fhir.r4.model.StringType(rawKey)
        );

        if (normalizeResponse.caseId() != null) {
            response.addExtension(
                "https://enstellar.simintero.com/fhir/StructureDefinition/case-id",
                new org.hl7.fhir.r4.model.StringType(normalizeResponse.caseId())
            );
        }

        Bundle responseBundle = new Bundle();
        responseBundle.setId(UUID.randomUUID().toString());
        responseBundle.setType(Bundle.BundleType.COLLECTION);
        responseBundle.setTimestamp(Date.from(Instant.now()));
        responseBundle.addEntry().setResource(response);

        return responseBundle;
    }

    private Claim extractClaim(Bundle bundle) {
        return bundle.getEntry().stream()
            .filter(e -> e.getResource() instanceof Claim)
            .map(e -> (Claim) e.getResource())
            .findFirst()
            .orElseThrow(() -> new InvalidRequestException("No Claim found in request bundle"));
    }

    /**
     * Extract the prior-auth tracking number from the Claim.identifier field.
     * Falls back to correlationId (Bundle.id) if no Claim.identifier is present.
     *
     * INVARIANT: never returns null.
     */
    private String extractClaimRef(Claim claim, String fallback) {
        return claim.getIdentifier().stream()
                .filter(id -> id.getValue() != null && !id.getValue().isBlank())
                .map(Identifier::getValue)
                .findFirst()
                .orElse(fallback);
    }
}
