package io.simintero.fhir;

import ca.uhn.fhir.context.FhirContext;
import io.simintero.fhir.pas.IntakeCommand;
import io.simintero.fhir.pas.PasMapper;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Identifier;
import org.hl7.fhir.r4.model.Reference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for PasMapper: verifies ClaimBundle → IntakeCommand field mapping.
 * No Spring context — pure unit test for fast feedback.
 */
class PasMappingTest {

    private static final FhirContext FHIR_CONTEXT = FhirContext.forR4();

    private PasMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new PasMapper(FHIR_CONTEXT);
    }

    /**
     * Build a minimal PAS-like Claim matching the spec's test data and assert
     * every required field on the resulting IntakeCommand.
     */
    @Test
    void mapsMinimalClaimToIntakeCommand() {
        Claim claim = buildTestClaim();

        IntakeCommand cmd = mapper.map(claim);

        assertThat(cmd.channel()).isEqualTo("PAS");
        assertThat(cmd.memberRef()).isEqualTo("Patient/pat-001");
        assertThat(cmd.coverageRef()).isEqualTo("Coverage/cov-001");
        assertThat(cmd.urgency()).isEqualTo("standard");
    }

    @Test
    void serviceLineIsMappedFromClaimItem() {
        Claim claim = buildTestClaim();

        IntakeCommand cmd = mapper.map(claim);

        assertThat(cmd.serviceLines()).hasSize(1);
        assertThat(cmd.serviceLines().get(0).code()).isEqualTo("27447");
    }

    @Test
    void rawPayloadRefIsNotNullOrEmpty() {
        IntakeCommand cmd = mapper.map(buildTestClaim());

        assertThat(cmd.rawPayloadRef()).isNotNull().isNotEmpty();
        // Phase 1 format: "raw:<base64>"
        assertThat(cmd.rawPayloadRef()).startsWith("raw:");
    }

    @Test
    void externalIdsAreMappedFromClaimIdentifier() {
        IntakeCommand cmd = mapper.map(buildTestClaim());

        assertThat(cmd.externalIds()).hasSize(1);
        assertThat(cmd.externalIds().get(0).system()).isEqualTo("urn:clearinghouse:id");
        assertThat(cmd.externalIds().get(0).value()).isEqualTo("REF-123");
    }

    @Test
    void payloadRefMatchesRawPayloadRefInPhase1() {
        IntakeCommand cmd = mapper.map(buildTestClaim());

        assertThat(cmd.payloadRef()).isEqualTo(cmd.rawPayloadRef());
    }

    /**
     * Claim items without a productOrService coding are silently skipped —
     * the resulting serviceLines list excludes them rather than throwing.
     * This matches the guard added to PasMapper.map() per code-quality fix #3.
     */
    @Test
    void itemWithoutProductOrServiceIsSkipped() {
        Claim claim = buildTestClaim();

        // Add a second item that has no productOrService at all
        Claim.ItemComponent bareItem = new Claim.ItemComponent();
        bareItem.setSequence(2);
        // intentionally no setProductOrService(...)
        claim.addItem(bareItem);

        IntakeCommand cmd = mapper.map(claim);

        // Only the valid CPT item should appear; the bare item is filtered out
        assertThat(cmd.serviceLines()).hasSize(1);
        assertThat(cmd.serviceLines().get(0).code()).isEqualTo("27447");
    }

    @Test
    void statPriorityMapsToExpedited() {
        Claim claim = buildTestClaim();
        claim.setPriority(new CodeableConcept().addCoding(new Coding().setCode("stat")));

        IntakeCommand cmd = mapper.map(claim);

        assertThat(cmd.urgency()).isEqualTo("expedited");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Minimal FHIR R4 Claim matching the spec's test fixture:
     *   patient = Patient/pat-001
     *   insurance[0].coverage = Coverage/cov-001
     *   priority = normal (→ standard)
     *   identifier[0] = {system: "urn:clearinghouse:id", value: "REF-123"}
     *   item[0] = CPT 27447
     */
    private Claim buildTestClaim() {
        Claim claim = new Claim();

        claim.setPatient(new Reference("Patient/pat-001"));

        Claim.InsuranceComponent insurance = new Claim.InsuranceComponent();
        insurance.setSequence(1);
        insurance.setFocal(true);
        insurance.setCoverage(new Reference("Coverage/cov-001"));
        claim.addInsurance(insurance);

        claim.setPriority(new CodeableConcept()
                .addCoding(new Coding().setCode("normal")));

        claim.addIdentifier(new Identifier()
                .setSystem("urn:clearinghouse:id")
                .setValue("REF-123"));

        Claim.ItemComponent item = new Claim.ItemComponent();
        item.setSequence(1);
        item.setProductOrService(new CodeableConcept()
                .addCoding(new Coding()
                        .setSystem("http://www.ama-assn.org/go/cpt")
                        .setCode("27447")));
        claim.addItem(item);

        return claim;
    }
}
