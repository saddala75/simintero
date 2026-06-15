package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.context.FhirContext;
import org.hl7.fhir.r4.model.*;

public class PasTestBundles {

    private static final FhirContext CTX = FhirContext.forR4();

    public static String validPasBundleJson() {
        Bundle bundle = new Bundle();
        bundle.setId("pas-test-bundle-001");
        bundle.setType(Bundle.BundleType.COLLECTION);

        Claim claim = new Claim();
        claim.setId("claim-001");
        claim.setUse(Claim.Use.PREAUTHORIZATION);
        claim.setStatus(Claim.ClaimStatus.ACTIVE);
        claim.setPatient(new Reference("Patient/pat-001"));
        claim.setProvider(new Reference("Practitioner/pract-001"));
        claim.addInsurance().setSequence(1).setFocal(true)
            .setCoverage(new Reference("Coverage/cov-001"));
        claim.addDiagnosis().setSequence(1)
            .setDiagnosis(new CodeableConcept(
                new Coding("http://hl7.org/fhir/sid/icd-10-cm", "M54.5", "Low back pain")));
        claim.addItem().setSequence(1)
            .setProductOrService(new CodeableConcept(
                new Coding("http://www.ama-assn.org/go/cpt", "97110", "Therapeutic Exercise")))
            .addDiagnosisSequence(1);
        bundle.addEntry().setResource(claim);

        Patient patient = new Patient();
        patient.setId("pat-001");
        patient.addName().setFamily("Smith").addGiven("Jane");
        bundle.addEntry().setResource(patient);

        Practitioner pract = new Practitioner();
        pract.setId("pract-001");
        pract.addName().setFamily("Jones").addGiven("Bob");
        bundle.addEntry().setResource(pract);

        Coverage coverage = new Coverage();
        coverage.setId("cov-001");
        coverage.addPayor().setDisplay("ACME Health Plan");
        bundle.addEntry().setResource(coverage);

        return CTX.newJsonParser().setPrettyPrint(false).encodeResourceToString(bundle);
    }
}
