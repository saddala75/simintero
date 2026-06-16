package com.simintero.enstellar.interop.dtr;

import ca.uhn.fhir.rest.annotation.Create;
import ca.uhn.fhir.rest.annotation.ResourceParam;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException;
import com.simintero.enstellar.interop.pas.PasClaimSubmitProvider;
import io.simintero.tenant.TenantContextHolder;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.QuestionnaireResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Accepts a completed DTR {@code QuestionnaireResponse}, assembles a PAS request bundle (QR as
 * supporting documentation) and hands it to the existing PAS {@code $submit} pipeline — the
 * decision path is NOT re-implemented here. Advisory only: this captures documentation and
 * forwards it; it never makes a determination. Reached via {@code POST /fhir/QuestionnaireResponse}.
 */
@Component
public class QuestionnaireResponseResourceProvider implements IResourceProvider {

    private static final Logger log = LoggerFactory.getLogger(QuestionnaireResponseResourceProvider.class);

    private final PasBundleAssembler assembler;
    private final PasClaimSubmitProvider pasSubmitProvider;

    public QuestionnaireResponseResourceProvider(PasBundleAssembler assembler,
                                                 PasClaimSubmitProvider pasSubmitProvider) {
        this.assembler = assembler;
        this.pasSubmitProvider = pasSubmitProvider;
    }

    @Override
    public Class<? extends IBaseResource> getResourceType() {
        return QuestionnaireResponse.class;
    }

    @Create
    public MethodOutcome create(@ResourceParam QuestionnaireResponse qr) {
        String tenant = TenantContextHolder.get().tenantId();
        if (qr.getStatus() == null || !qr.hasQuestionnaire()) {
            throw new UnprocessableEntityException(
                    "QuestionnaireResponse must have status and a questionnaire reference");
        }
        if (!qr.hasSubject() || qr.getSubject().getReferenceElement() == null
                || qr.getSubject().getReferenceElement().getIdPart() == null) {
            throw new UnprocessableEntityException(
                    "QuestionnaireResponse.subject (patient reference) is required");
        }
        String serviceCode = deriveServiceCode(qr.getQuestionnaire());
        if (serviceCode.isBlank()) {
            throw new UnprocessableEntityException(
                    "Could not derive a service code from QuestionnaireResponse.questionnaire");
        }
        String patientId = qr.getSubject().getReferenceElement().getIdPart();
        log.info("dtr_qr_submit tenant={} service={}", tenant, serviceCode);

        Bundle pas = assembler.toPasBundle(qr, serviceCode, patientId);
        pasSubmitProvider.submit(pas); // reuse the existing PAS pipeline (TenantContext already set)

        return new MethodOutcome().setCreated(true).setResource(qr);
    }

    /** Extract the service code from a Questionnaire canonical like ".../Questionnaire/dtr-svc-1". */
    private String deriveServiceCode(String canonical) {
        String tail = canonical.substring(canonical.lastIndexOf('/') + 1);
        return tail.startsWith("dtr-") ? tail.substring("dtr-".length()) : tail;
    }
}
