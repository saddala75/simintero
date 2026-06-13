package io.simintero.fhir.pas;

import ca.uhn.fhir.rest.annotation.Operation;
import ca.uhn.fhir.rest.annotation.ResourceParam;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.InternalErrorException;
import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import ca.uhn.fhir.rest.server.exceptions.NotImplementedOperationException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.OperationOutcome;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.UUID;

/**
 * HAPI resource provider for Da Vinci PAS operations on Claim.
 *
 * Endpoints exposed:
 *   POST /fhir/Claim/$submit   → 200 + OperationOutcome (async accept)
 *   POST /fhir/Claim/$inquire  → 501 (Phase 1B)
 *   POST /fhir/Claim/$cancel   → 501 (Phase 1B)
 *
 * PHI CONTRACT: No patient data is written to any log statement. The
 * tracking ID in the OperationOutcome is a random UUID — no PHI.
 */
@Component
public class PasProvider implements IResourceProvider {

    private static final Logger LOG = LoggerFactory.getLogger(PasProvider.class);

    private final PasMapper pasMapper;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final String intakeServiceUrl;

    public PasProvider(
            PasMapper pasMapper,
            RestTemplate restTemplate,
            ObjectMapper objectMapper,
            @Value("${intake.service.url:http://localhost:3010}") String intakeServiceUrl) {
        this.pasMapper = pasMapper;
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.intakeServiceUrl = intakeServiceUrl;
    }

    @Override
    public Class<? extends IBaseResource> getResourceType() {
        return Claim.class;
    }

    /**
     * Da Vinci PAS $submit — accepts a ClaimBundle (or bare Claim for Phase 1)
     * and asynchronously forwards it to the intake service.
     */
    @Operation(name = "$submit", idempotent = false)
    public OperationOutcome submit(@ResourceParam IBaseResource theResource) {
        Claim claim = extractClaim(theResource);
        IntakeCommand command = pasMapper.map(claim);
        postToIntakeService(command);

        String trackingId = UUID.randomUUID().toString();
        OperationOutcome outcome = new OperationOutcome();
        outcome.addIssue()
                .setSeverity(OperationOutcome.IssueSeverity.INFORMATION)
                .setCode(OperationOutcome.IssueType.INFORMATIONAL)
                .setDiagnostics("Submission accepted. Processing is asynchronous. Tracking ID: " + trackingId);
        return outcome;
    }

    /**
     * Da Vinci PAS $inquire — not implemented in Phase 1, returns HTTP 501.
     */
    @Operation(name = "$inquire", idempotent = true)
    public OperationOutcome inquire(@ResourceParam IBaseResource theResource) {
        throw new NotImplementedOperationException("$inquire is not implemented in Phase 1");
    }

    /**
     * Da Vinci PAS $cancel — not implemented in Phase 1, returns HTTP 501.
     */
    @Operation(name = "$cancel", idempotent = false)
    public OperationOutcome cancel(@ResourceParam IBaseResource theResource) {
        throw new NotImplementedOperationException("$cancel is not implemented in Phase 1");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private Claim extractClaim(IBaseResource resource) {
        if (resource instanceof Claim c) {
            return c;
        }
        if (resource instanceof Bundle bundle) {
            return bundle.getEntry().stream()
                    .filter(e -> e.getResource() instanceof Claim)
                    .map(e -> (Claim) e.getResource())
                    .findFirst()
                    .orElseThrow(() -> new InvalidRequestException(
                            "Bundle did not contain a Claim entry"));
        }
        throw new InvalidRequestException(
                "Expected Claim or Bundle resource, got: " + resource.getClass().getSimpleName());
    }

    private void postToIntakeService(IntakeCommand command) {
        try {
            String commandJson = objectMapper.writeValueAsString(command);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            restTemplate.postForEntity(
                    intakeServiceUrl + "/internal/intake/commands",
                    new HttpEntity<>(commandJson, headers),
                    String.class);
            LOG.info("IntakeCommand forwarded to intake service. channel={}", command.channel());
        } catch (RestClientException e) {
            LOG.warn("Intake service unreachable. channel={} error={}",
                    command.channel(), e.getClass().getSimpleName());
            throw new InternalErrorException("Intake service unavailable — submission not persisted");
        } catch (Exception e) {
            LOG.warn("Failed to serialize or post IntakeCommand. channel={} error={}",
                    command.channel(), e.getClass().getSimpleName());
            throw new InternalErrorException("Internal error processing submission");
        }
    }
}
