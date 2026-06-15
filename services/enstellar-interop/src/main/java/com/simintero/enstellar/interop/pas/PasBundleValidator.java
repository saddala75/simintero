package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.rest.server.exceptions.UnprocessableEntityException;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.Coverage;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Practitioner;
import org.springframework.stereotype.Component;

@Component
public class PasBundleValidator {

    public void validate(Bundle bundle) {
        if (bundle == null) {
            throw new UnprocessableEntityException("Bundle is null — cannot process $submit request");
        }

        if (bundle.getType() != Bundle.BundleType.COLLECTION) {
            throw new UnprocessableEntityException(
                "PAS Bundle.type must be 'collection'; got: " + bundle.getType()
            );
        }

        Claim claim = null;
        boolean hasPatient = false;
        boolean hasPractitioner = false;
        boolean hasCoverage = false;

        for (Bundle.BundleEntryComponent entry : bundle.getEntry()) {
            if (entry.getResource() instanceof Claim c) {
                claim = c;
            } else if (entry.getResource() instanceof Patient) {
                hasPatient = true;
            } else if (entry.getResource() instanceof Practitioner) {
                hasPractitioner = true;
            } else if (entry.getResource() instanceof Coverage) {
                hasCoverage = true;
            }
        }

        if (claim == null) {
            throw new UnprocessableEntityException(
                "PAS Bundle must contain exactly one Claim resource"
            );
        }

        if (claim.getUse() != Claim.Use.PREAUTHORIZATION) {
            throw new UnprocessableEntityException(
                "Claim.use must be 'preauthorization' for PAS; got: " + claim.getUse()
            );
        }

        if (!hasPatient) {
            throw new UnprocessableEntityException(
                "PAS Bundle must contain a Patient resource (referenced by Claim.patient)"
            );
        }

        if (!hasPractitioner) {
            throw new UnprocessableEntityException(
                "PAS Bundle must contain at least one Practitioner resource (referenced by Claim.provider)"
            );
        }

        if (!hasCoverage) {
            throw new UnprocessableEntityException(
                "PAS Bundle must contain a Coverage resource (referenced by Claim.insurance[].coverage)"
            );
        }

        if (claim.getInsurance().isEmpty()) {
            throw new UnprocessableEntityException(
                "Claim.insurance must be non-empty"
            );
        }

        if (claim.getItem().isEmpty()) {
            throw new UnprocessableEntityException(
                "Claim.item must be non-empty — at least one service line required"
            );
        }
    }
}
