package com.simintero.enstellar.interop.dtr;

import com.simintero.enstellar.interop.pas.PasBundleValidator;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.QuestionnaireResponse;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class PasBundleAssemblerTest {

    private final PasBundleAssembler assembler = new PasBundleAssembler();

    private QuestionnaireResponse completedQr() {
        QuestionnaireResponse qr = new QuestionnaireResponse();
        qr.setStatus(QuestionnaireResponse.QuestionnaireResponseStatus.COMPLETED);
        qr.setQuestionnaire("https://enstellar.simintero.com/Questionnaire/dtr-svc-1");
        return qr;
    }

    @Test
    void wraps_qr_into_collection_bundle_with_preauth_claim() {
        Bundle bundle = assembler.toPasBundle(completedQr(), "svc-1", "patient-1");

        assertThat(bundle.getType()).isEqualTo(Bundle.BundleType.COLLECTION);
        assertThat(bundle.getEntry()).anyMatch(e -> e.getResource() instanceof QuestionnaireResponse);
        assertThat(bundle.getEntry()).anyMatch(e -> e.getResource() instanceof Claim
                && ((Claim) e.getResource()).getUse() == Claim.Use.PREAUTHORIZATION);
    }

    @Test
    void assembled_bundle_satisfies_pas_validator() {
        Bundle bundle = assembler.toPasBundle(completedQr(), "svc-1", "patient-1");
        assertThatCode(() -> new PasBundleValidator().validate(bundle)).doesNotThrowAnyException();
    }

    @Test
    void synthesized_coverage_is_tagged_as_placeholder_provenance() {
        Bundle bundle = assembler.toPasBundle(completedQr(), "svc-1", "patient-1");
        var coverage = bundle.getEntry().stream()
                .map(e -> e.getResource())
                .filter(r -> r instanceof org.hl7.fhir.r4.model.Coverage)
                .findFirst().orElseThrow();
        boolean tagged = coverage.getMeta().getSecurity().stream().anyMatch(c ->
                PasBundleAssembler.PROVENANCE_SYSTEM.equals(c.getSystem())
                        && PasBundleAssembler.PLACEHOLDER_CODE.equals(c.getCode()));
        assertThat(tagged).as("synthesized coverage marked as DTR placeholder").isTrue();
    }
}
