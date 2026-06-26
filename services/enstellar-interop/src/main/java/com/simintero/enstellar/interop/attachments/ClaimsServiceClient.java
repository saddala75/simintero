package com.simintero.enstellar.interop.attachments;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * HTTP client that notifies the claims service when a C-CDA attachment is received or rejected.
 * Mirrors the WebClient pattern in {@code ClearinghouseRfaiClient}.
 */
@Component
public class ClaimsServiceClient {

    private static final Logger log = LoggerFactory.getLogger(ClaimsServiceClient.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(30);

    private final WebClient webClient;

    public ClaimsServiceClient(ClaimsConfig config) {
        this.webClient = WebClient.builder().baseUrl(config.baseUrl()).build();
    }

    /**
     * Notify the claims service that an attachment was successfully received and stored.
     *
     * @param claimId    payer claim ID
     * @param caseRef    internal case reference
     * @param docId      MinIO object key (UUID) of the stored C-CDA
     * @param tenantId   tenant identifier
     * @param loincCodes LOINC codes from the 275 PWK segment
     */
    public void notifyReceived(String claimId, String caseRef, String docId,
                               String tenantId, List<String> loincCodes) {
        try {
            webClient.post()
                    .uri("/v1/internal/attachment-received")
                    .header("Content-Type", "application/json")
                    .bodyValue(Map.of(
                            "claim_id", claimId,
                            "case_ref", caseRef,
                            "doc_id", docId,
                            "tenant_id", tenantId,
                            "loinc_codes", loincCodes
                    ))
                    .retrieve()
                    .toBodilessEntity()
                    .block(TIMEOUT);
            log.info("[claims-client] attachment-received claimId={} docId={}", claimId, docId);
        } catch (Exception ex) {
            log.error("[claims-client] notify-received failed claimId={} error={}", claimId, ex.getMessage());
            throw new RuntimeException("Claims notify-received failed", ex);
        }
    }

    /**
     * Notify the claims service that an attachment was rejected (e.g. invalid XMLDSig).
     *
     * @param claimId  payer claim ID
     * @param tenantId tenant identifier
     * @param reason   rejection reason code
     */
    public void notifyRejected(String claimId, String tenantId, String reason) {
        try {
            webClient.post()
                    .uri("/v1/internal/attachment-rejected")
                    .header("Content-Type", "application/json")
                    .bodyValue(Map.of("claim_id", claimId, "tenant_id", tenantId, "reason", reason))
                    .retrieve()
                    .toBodilessEntity()
                    .block(TIMEOUT);
            log.info("[claims-client] attachment-rejected claimId={} reason={}", claimId, reason);
        } catch (Exception ex) {
            log.error("[claims-client] notify-rejected failed claimId={} error={}", claimId, ex.getMessage());
            throw new RuntimeException("Claims notify-rejected failed", ex);
        }
    }
}
