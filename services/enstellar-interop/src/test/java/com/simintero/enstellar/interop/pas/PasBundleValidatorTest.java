package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.Coverage;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Practitioner;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class PasBundleValidatorTest {

    private static PasBundleValidator validator;

    @BeforeAll
    static void setup() {
        validator = new PasBundleValidator();
    }

    private Bundle validBundle() {
        Bundle bundle = new Bundle();
        bundle.setType(Bundle.BundleType.COLLECTION);

        Claim claim = new Claim();
        claim.setId("claim-001");
        claim.setUse(Claim.Use.PREAUTHORIZATION);
        claim.setStatus(Claim.ClaimStatus.ACTIVE);
        claim.addItem().setSequence(1);
        claim.addInsurance().setSequence(1).setFocal(true)
            .setCoverage(new org.hl7.fhir.r4.model.Reference("Coverage/cov-001"));
        bundle.addEntry().setResource(claim);

        bundle.addEntry().setResource(new Patient().setId("pat-001"));
        bundle.addEntry().setResource(new Practitioner().setId("pract-001"));
        bundle.addEntry().setResource(new Coverage().setId("cov-001"));

        return bundle;
    }

    @Test
    void validBundle_doesNotThrow() {
        assertDoesNotThrow(() -> validator.validate(validBundle()));
    }

    @Test
    void nullBundle_throwsUnprocessableEntityException() {
        UnprocessableEntityException ex = assertThrows(UnprocessableEntityException.class,
            () -> validator.validate(null));
        assertTrue(ex.getMessage().contains("null"));
    }

    @Test
    void wrongBundleType_throwsUnprocessableEntityException() {
        Bundle bundle = validBundle();
        bundle.setType(Bundle.BundleType.TRANSACTION);
        UnprocessableEntityException ex = assertThrows(UnprocessableEntityException.class,
            () -> validator.validate(bundle));
        assertTrue(ex.getMessage().contains("collection"));
    }

    @Test
    void missingClaim_throwsUnprocessableEntityException() {
        Bundle bundle = new Bundle();
        bundle.setType(Bundle.BundleType.COLLECTION);
        bundle.addEntry().setResource(new Patient().setId("pat-001"));
        UnprocessableEntityException ex = assertThrows(UnprocessableEntityException.class,
            () -> validator.validate(bundle));
        assertTrue(ex.getMessage().contains("Claim"));
    }

    @Test
    void wrongClaimUse_throwsUnprocessableEntityException() {
        Bundle bundle = validBundle();
        bundle.getEntry().stream()
            .filter(e -> e.getResource() instanceof Claim)
            .forEach(e -> ((Claim) e.getResource()).setUse(Claim.Use.CLAIM));
        UnprocessableEntityException ex = assertThrows(UnprocessableEntityException.class,
            () -> validator.validate(bundle));
        assertTrue(ex.getMessage().contains("preauthorization"));
    }

    @Test
    void missingPatient_throwsUnprocessableEntityException() {
        Bundle bundle = validBundle();
        bundle.getEntry().removeIf(e -> e.getResource() instanceof Patient);
        UnprocessableEntityException ex = assertThrows(UnprocessableEntityException.class,
            () -> validator.validate(bundle));
        assertTrue(ex.getMessage().contains("Patient"));
    }

    @Test
    void missingPractitioner_throwsUnprocessableEntityException() {
        Bundle bundle = validBundle();
        bundle.getEntry().removeIf(e -> e.getResource() instanceof Practitioner);
        UnprocessableEntityException ex = assertThrows(UnprocessableEntityException.class,
            () -> validator.validate(bundle));
        assertTrue(ex.getMessage().contains("Practitioner"));
    }

    @Test
    void missingCoverage_throwsUnprocessableEntityException() {
        Bundle bundle = validBundle();
        bundle.getEntry().removeIf(e -> e.getResource() instanceof Coverage);
        UnprocessableEntityException ex = assertThrows(UnprocessableEntityException.class,
            () -> validator.validate(bundle));
        assertTrue(ex.getMessage().contains("Coverage"));
    }

    @Test
    void emptyItems_throwsUnprocessableEntityException() {
        Bundle bundle = validBundle();
        bundle.getEntry().stream()
            .filter(e -> e.getResource() instanceof Claim)
            .forEach(e -> ((Claim) e.getResource()).getItem().clear());
        UnprocessableEntityException ex = assertThrows(UnprocessableEntityException.class,
            () -> validator.validate(bundle));
        assertTrue(ex.getMessage().contains("item"));
    }
}
