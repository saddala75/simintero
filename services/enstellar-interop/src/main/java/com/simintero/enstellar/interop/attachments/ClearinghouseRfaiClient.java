package com.simintero.enstellar.interop.attachments;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.List;

/**
 * HTTP client that POSTs a 277-RFAI EDI document to the clearinghouse adapter.
 * Mirrors the WebClient pattern in {@code document/DocumentServiceClient}.
 */
@Component
public class ClearinghouseRfaiClient {

    private static final Logger log = LoggerFactory.getLogger(ClearinghouseRfaiClient.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(30);

    private final WebClient webClient;

    public ClearinghouseRfaiClient(ClearinghouseConfig config) {
        this.webClient = WebClient.builder().baseUrl(config.baseUrl()).build();
    }

    /**
     * Build and POST a 277-RFAI for the given claim. Blocks until the clearinghouse adapter
     * acknowledges (2xx) or throws {@link RfaiSendException} on any error.
     */
    public void sendRfai(String rfaiId, String claimId, String caseRef,
                         List<String> loincCodes, String tenantId) {
        String ediBody = RfaiBuilder.build(rfaiId, claimId, caseRef, loincCodes);
        try {
            webClient.post()
                    .uri("/rfai")
                    .header("Content-Type", "application/x12")
                    .header("X-Sim-Tenant-Id", tenantId)
                    .bodyValue(ediBody)
                    .retrieve()
                    .toBodilessEntity()
                    .block(TIMEOUT);
            log.info("[rfai] sent rfaiId={} claimId={} loincCount={}", rfaiId, claimId, loincCodes.size());
        } catch (Exception ex) {
            log.error("[rfai] failed rfaiId={} error={}", rfaiId, ex.getMessage());
            throw new RfaiSendException("RFAI send failed for " + rfaiId, ex);
        }
    }
}
