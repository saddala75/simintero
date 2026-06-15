package com.simintero.enstellar.interop.dtr;

import org.hl7.fhir.r4.model.*;
import org.springframework.stereotype.Component;

/**
 * Assembles a Da Vinci PAS request Bundle from a completed DTR QuestionnaireResponse so the
 * existing PAS {@code $submit} pipeline can run. The QuestionnaireResponse rides as supporting
 * documentation. The synthesized Patient/Practitioner/Coverage/Claim are minimal but satisfy
 * {@code PasBundleValidator}; a real flow carries fuller resources from the EHR/DTR context.
 */
@Component
public class PasBundleAssembler {

    private static final String SERVICE_CODE_SYSTEM = "https://enstellar.simintero.com/service-code";
    // Marks resources synthesized by DTR to satisfy the PAS bundle shape — NOT verified EHR data.
    // Downstream deterministic rules must not treat these as authoritative (e.g. verified coverage).
    static final String PROVENANCE_SYSTEM = "https://enstellar.simintero.com/provenance";
    static final String PLACEHOLDER_CODE = "dtr-synthesized-placeholder";

    private static <T extends org.hl7.fhir.r4.model.Resource> T tagPlaceholder(T resource) {
        resource.getMeta().addSecurity(new Coding().setSystem(PROVENANCE_SYSTEM).setCode(PLACEHOLDER_CODE));
        return resource;
    }

    public Bundle toPasBundle(QuestionnaireResponse qr, String serviceCode, String patientId) {
        Bundle bundle = new Bundle();
        bundle.setType(Bundle.BundleType.COLLECTION);

        Patient patient = tagPlaceholder(new Patient());
        patient.setId(patientId);

        Practitioner practitioner = tagPlaceholder(new Practitioner());
        practitioner.setId("dtr-provider");

        Coverage coverage = tagPlaceholder(new Coverage());
        coverage.setId("dtr-coverage");
        coverage.setStatus(Coverage.CoverageStatus.ACTIVE);
        coverage.setBeneficiary(new Reference("Patient/" + patientId));

        Claim claim = new Claim();
        claim.setId("dtr-claim");
        claim.setStatus(Claim.ClaimStatus.ACTIVE);
        claim.setUse(Claim.Use.PREAUTHORIZATION);
        claim.setPatient(new Reference("Patient/" + patientId));
        claim.setProvider(new Reference("Practitioner/dtr-provider"));
        Claim.InsuranceComponent insurance = claim.addInsurance();
        insurance.setSequence(1);
        insurance.setFocal(true);
        insurance.setCoverage(new Reference("Coverage/dtr-coverage"));
        Claim.ItemComponent item = claim.addItem();
        item.setSequence(1);
        item.setProductOrService(new CodeableConcept().addCoding(
                new Coding().setSystem(SERVICE_CODE_SYSTEM).setCode(serviceCode)));

        bundle.addEntry().setResource(patient);
        bundle.addEntry().setResource(practitioner);
        bundle.addEntry().setResource(coverage);
        bundle.addEntry().setResource(claim);
        bundle.addEntry().setResource(qr); // DTR documentation as supporting info
        return bundle;
    }
}
