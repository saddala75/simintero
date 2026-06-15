package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.rest.annotation.IdParam;
import ca.uhn.fhir.rest.annotation.Operation;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import com.simintero.enstellar.interop.auth.TenantContext;
import com.simintero.enstellar.interop.decision.ClaimResponseBuilder;
import com.simintero.enstellar.interop.decision.DecisionRecord;
import com.simintero.enstellar.interop.decision.DecisionStore;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.IdType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * HAPI FHIR operation provider for Claim/$inquire (Da Vinci PAS).
 *
 * GET [base]/Claim/{correlationId}/$inquire
 *   Returns: Bundle containing a ClaimResponse with the current authorization status.
 *
 * Status resolution (T11):
 *   - DecisionRecord not found → 404 ResourceNotFoundException
 *   - DecisionRecord.outcome IS NULL → pending ClaimResponse (outcome=QUEUED)
 *   - DecisionRecord.outcome IS NOT NULL → complete ClaimResponse (outcome=COMPLETE)
 *
 * INVARIANT #5: all queries include tenant_id to prevent cross-tenant access.
 */
@Component
public class PasClaimInquireProvider implements IResourceProvider {

    private static final Logger log = LoggerFactory.getLogger(PasClaimInquireProvider.class);

    private final DecisionStore decisionStore;
    private final ClaimResponseBuilder claimResponseBuilder;

    public PasClaimInquireProvider(DecisionStore decisionStore,
                                   ClaimResponseBuilder claimResponseBuilder) {
        this.decisionStore = decisionStore;
        this.claimResponseBuilder = claimResponseBuilder;
    }

    @Override
    public Class<? extends IBaseResource> getResourceType() {
        return Claim.class;
    }

    /**
     * Handle GET [base]/Claim/{correlationId}/$inquire.
     *
     * The {correlationId} path parameter is the Bundle.id used at $submit time.
     *
     * @param correlationId  The correlation ID from the original $submit (Bundle.id).
     * @return Bundle containing a ClaimResponse reflecting current authorization status.
     * @throws ResourceNotFoundException if no case found for this correlationId + tenantId.
     */
    @Operation(name = "$inquire", idempotent = true, type = Claim.class)
    public Bundle inquire(@IdParam IdType correlationId) {
        String tenantId = TenantContext.require();
        String corrId = correlationId.getIdPart();

        log.info("pas_inquire tenant={} correlation_id={}", tenantId, corrId);

        Optional<DecisionRecord> record =
                decisionStore.findByCorrelationIdAndTenantId(corrId, tenantId);

        if (record.isEmpty()) {
            log.info("pas_inquire_not_found tenant={} correlation_id={}", tenantId, corrId);
            throw new ResourceNotFoundException(
                    "No prior authorization found for correlation_id=" + corrId);
        }

        DecisionRecord dr = record.get();

        if (dr.getOutcome() == null) {
            log.info("pas_inquire_pending tenant={} correlation_id={} case_id={}",
                    tenantId, corrId, dr.getCaseId());
            return claimResponseBuilder.buildPendingBundle(dr);
        }

        log.info("pas_inquire_complete tenant={} correlation_id={} case_id={} outcome={}",
                tenantId, corrId, dr.getCaseId(), dr.getOutcome());
        return claimResponseBuilder.buildBundle(dr);
    }
}
