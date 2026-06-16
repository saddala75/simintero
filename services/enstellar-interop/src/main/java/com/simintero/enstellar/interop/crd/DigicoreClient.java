package com.simintero.enstellar.interop.crd;

import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriUtils;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * HTTP client for the digicore-runtime (ratified C-1 API) serving CRD coverage content + DTR
 * questionnaires. Unauthenticated; base path {@code /v1/runtime}. Mirrors the WebClient pattern in
 * {@code pas/NormalizationClient}.
 */
@Component
public class DigicoreClient {

    private static final Duration TIMEOUT = Duration.ofSeconds(15);

    /** Path serving the in-house DTR renderer launch (see {@link com.simintero.enstellar.interop.dtr.DtrLaunchController}). */
    private static final String DTR_LAUNCH_PATH = "/dtr/launch";

    private final WebClient webClient;

    public DigicoreClient(DigicoreConfig config) {
        this.webClient = WebClient.builder().baseUrl(config.baseUrl()).build();
    }

    /**
     * Coverage requirements for an ordered service. Assembles {@link CrdContent} from the C-1
     * coverage-discovery + evidence-requirements endpoints. memberId/planId/tenantId are retained
     * in the signature for caller compatibility even though the C-1 stub does not use them.
     */
    public CrdContent getCrdContent(String serviceCode, String memberId, String planId, String tenantId) {
        CoverageDiscoveryResponse cov = coverageDiscovery(serviceCode);

        EvidenceRequirementsResponse req = webClient.post()
                .uri("/v1/runtime/evidence-requirements:resolve")
                .bodyValue(Map.of("service_code", serviceCode))
                .retrieve()
                .bodyToMono(EvidenceRequirementsResponse.class)
                .block(TIMEOUT);

        String ruleReference = (cov.governingRules() == null || cov.governingRules().isEmpty())
                ? ""
                : cov.governingRules().get(0).ruleId();

        List<String> documentationRequirements = (req == null || req.requirements() == null)
                ? List.of()
                : req.requirements().stream()
                        .map(EvidenceRequirementsResponse.Requirement::display)
                        .toList();

        String dtrLaunchUrl = cov.dtrPackageRef() == null
                ? null
                : DTR_LAUNCH_PATH + "?package="
                        + UriUtils.encode(cov.dtrPackageRef(), StandardCharsets.UTF_8);

        return new CrdContent(cov.paRequired(), documentationRequirements, ruleReference, dtrLaunchUrl);
    }

    /**
     * Raw DTR Questionnaire JSON for a service/plan. Resolves the DTR package ref via
     * coverage-discovery, then fetches the package. Returns {@code null} when no DTR package
     * applies (preserves the caller's existing behavior). planId/tenantId are retained in the
     * signature for caller compatibility.
     */
    public String getQuestionnaire(String serviceCode, String planId, String tenantId) {
        CoverageDiscoveryResponse cov = coverageDiscovery(serviceCode);
        String ref = cov.dtrPackageRef();
        if (ref == null) {
            return null;
        }
        return webClient.get()
                .uri("/v1/runtime/dtr-packages/{ref}", ref)
                .retrieve()
                .bodyToMono(String.class)
                .block(TIMEOUT);
    }

    private CoverageDiscoveryResponse coverageDiscovery(String serviceCode) {
        return webClient.post()
                .uri("/v1/runtime/coverage-discovery")
                .bodyValue(Map.of("service_code", serviceCode, "procedure_code", serviceCode))
                .retrieve()
                .bodyToMono(CoverageDiscoveryResponse.class)
                .block(TIMEOUT);
    }
}
