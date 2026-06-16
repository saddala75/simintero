package com.simintero.enstellar.interop.document;

import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.Map;

/**
 * HTTP client for the platform Document Service. Ingests a single document via
 * {@code POST /documents/ingest}, returning the created {@code doc_id}.
 * Mirrors the WebClient pattern in {@code crd/DigicoreClient}.
 */
@Component
public class DocumentServiceClient {

    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private final WebClient webClient;

    public DocumentServiceClient(DocumentServiceConfig config) {
        this.webClient = WebClient.builder().baseUrl(config.baseUrl()).build();
    }

    /**
     * Ingest one document. {@code rawPayloadBase64} is the base64-encoded document bytes.
     * Returns the created doc_id (may be null if the service omits it).
     */
    public String ingest(String channel, String rawPayloadBase64, String caseRef, String tenantId) {
        IngestResponse response = webClient.post()
                .uri("/documents/ingest")
                .header("x-sim-tenant-id", tenantId)
                .bodyValue(Map.of(
                        "channel", channel,
                        "raw_payload", rawPayloadBase64,
                        "case_ref", caseRef,
                        "created_by", Map.of("type", "service", "id", "enstellar-interop")
                ))
                .retrieve()
                .bodyToMono(IngestResponse.class)
                .block(TIMEOUT);
        return response == null ? null : response.docId();
    }

    /** Response body of {@code POST /documents/ingest}: {@code {"doc_id": "..."}}. */
    record IngestResponse(@com.fasterxml.jackson.annotation.JsonProperty("doc_id") String docId) {}
}
