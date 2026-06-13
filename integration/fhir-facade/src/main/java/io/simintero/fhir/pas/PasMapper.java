package io.simintero.fhir.pas;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.parser.IParser;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;

/**
 * Maps a FHIR R4 Claim (PAS-profiled) to the canonical IntakeCommand envelope.
 * This is the only class allowed to import org.hl7.fhir types outside of
 * the crd/ subpackage — all FHIR wire-format knowledge stays in integration/.
 *
 * PHI CONTRACT: rawPayloadRef is base64(serialized Claim). No PHI is written
 * to any log output from this class.
 */
@Component
public class PasMapper {

    private final FhirContext fhirContext;

    public PasMapper(FhirContext fhirContext) {
        this.fhirContext = fhirContext;
    }

    /**
     * Convert a FHIR Claim to an IntakeCommand.
     *
     * @param claim parsed FHIR R4 Claim
     * @return populated IntakeCommand; rawPayloadRef is always non-null
     */
    public IntakeCommand map(Claim claim) {
        String memberRef = claim.hasPatient()
                ? claim.getPatient().getReference()
                : null;

        String coverageRef = null;
        if (!claim.getInsurance().isEmpty()) {
            Claim.InsuranceComponent insurance = claim.getInsurance().get(0);
            if (insurance.hasCoverage()) {
                coverageRef = insurance.getCoverage().getReference();
            }
        }

        String urgency = mapUrgency(claim.getPriority());

        List<IntakeCommand.ServiceLine> serviceLines = claim.getItem().stream()
                .filter(item -> item.hasProductOrService()
                        && !item.getProductOrService().getCoding().isEmpty())
                .map(item -> {
                    Coding coding = item.getProductOrService().getCodingFirstRep();
                    int qty = item.hasQuantity()
                            ? item.getQuantity().getValue().intValue()
                            : 1;
                    return new IntakeCommand.ServiceLine(
                            coding.getCode(),
                            coding.getSystem(),
                            qty
                    );
                })
                .toList();

        List<IntakeCommand.ExternalId> externalIds = claim.getIdentifier().stream()
                .map(id -> new IntakeCommand.ExternalId(id.getSystem(), id.getValue()))
                .toList();

        // Serialize claim → base64 for object-store reference (Phase 1 raw storage)
        IParser jsonParser = fhirContext.newJsonParser();
        String claimJson = jsonParser.encodeResourceToString(claim);
        String rawPayloadRef = "raw:" + Base64.getEncoder().encodeToString(claimJson.getBytes(StandardCharsets.UTF_8));

        return new IntakeCommand(
                "PAS",
                null,                                    // caseRef — null for new submissions
                rawPayloadRef,
                rawPayloadRef,                           // same as payloadRef in Phase 1
                Instant.now().toString(),
                memberRef,
                coverageRef,
                new IntakeCommand.Providers(null, null), // NPI extraction is Phase 1B
                serviceLines,
                urgency,
                externalIds
        );
    }

    /**
     * Map FHIR Claim.priority code to "standard" | "expedited".
     * Da Vinci PAS uses "normal" → standard and "stat"/"urgent" → expedited.
     */
    private String mapUrgency(CodeableConcept priority) {
        if (priority == null) {
            return "standard";
        }
        // Try the first coding code
        if (priority.hasCoding()) {
            String code = priority.getCodingFirstRep().getCode();
            if (code != null && isExpedited(code)) {
                return "expedited";
            }
        }
        // Fall back to text
        String text = priority.getText();
        if (text != null && isExpedited(text)) {
            return "expedited";
        }
        return "standard";
    }

    private boolean isExpedited(String value) {
        return "stat".equalsIgnoreCase(value)
                || "urgent".equalsIgnoreCase(value)
                || "expedited".equalsIgnoreCase(value);
    }
}
