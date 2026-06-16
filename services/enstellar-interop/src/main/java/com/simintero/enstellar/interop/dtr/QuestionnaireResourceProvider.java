package com.simintero.enstellar.interop.dtr;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.annotation.OptionalParam;
import ca.uhn.fhir.rest.annotation.RequiredParam;
import ca.uhn.fhir.rest.annotation.Search;
import ca.uhn.fhir.rest.param.StringParam;
import ca.uhn.fhir.rest.server.IResourceProvider;
import com.simintero.enstellar.interop.crd.DigicoreClient;
import io.simintero.tenant.TenantContextHolder;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.Questionnaire;

import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Serves the DTR {@code Questionnaire} (with embedded/linked CQL) sourced from Digicore.
 * CQL executes client-side in the DTR/EHR app — this service only serves the artifact.
 * Reached via {@code GET /fhir/Questionnaire?context={serviceCode}&plan={planId}}.
 */
@Component
public class QuestionnaireResourceProvider implements IResourceProvider {

    private final DigicoreClient digicore;
    private final FhirContext fhirContext;

    public QuestionnaireResourceProvider(DigicoreClient digicore, FhirContext fhirContext) {
        this.digicore = digicore;
        this.fhirContext = fhirContext;
    }

    @Override
    public Class<? extends IBaseResource> getResourceType() {
        return Questionnaire.class;
    }

    @Search
    public List<Questionnaire> search(
            @RequiredParam(name = "context") StringParam context,
            @OptionalParam(name = "plan") StringParam plan) {
        String tenant = TenantContextHolder.get().tenantId();
        String planId = plan != null ? plan.getValue() : "unknown";
        String json = digicore.getQuestionnaire(context.getValue(), planId, tenant);
        if (json == null) {
            throw new ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException(
                    "No DTR package for context=" + context.getValue());
        }
        Questionnaire q = fhirContext.newJsonParser().parseResource(Questionnaire.class, json);
        return List.of(q);
    }
}
