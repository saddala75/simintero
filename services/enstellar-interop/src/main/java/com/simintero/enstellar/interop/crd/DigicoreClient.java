package com.simintero.enstellar.interop.crd;

import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;

/**
 * HTTP client for the Digicore content service (CRD coverage content + DTR questionnaires).
 * Mirrors the WebClient pattern in {@code pas/NormalizationClient}.
 */
@Component
public class DigicoreClient {

    private final WebClient webClient;

    public DigicoreClient(DigicoreConfig config) {
        this.webClient = WebClient.builder().baseUrl(config.baseUrl()).build();
    }

    /** Coverage requirements for an ordered service ({@code GET /api/v1/crd}). */
    public CrdContent getCrdContent(String serviceCode, String memberId, String planId, String tenantId) {
        return webClient.get()
                .uri(uri -> uri.path("/api/v1/crd")
                        .queryParam("service_code", serviceCode)
                        .queryParam("member_id", memberId)
                        .queryParam("plan_id", planId)
                        .queryParam("tenant_id", tenantId)
                        .build())
                .retrieve()
                .bodyToMono(CrdContent.class)
                .block(Duration.ofSeconds(15));
    }

    /** Raw DTR Questionnaire(+CQL) JSON for a service/plan ({@code GET /api/v1/questionnaire}). */
    public String getQuestionnaire(String serviceCode, String planId, String tenantId) {
        return webClient.get()
                .uri(uri -> uri.path("/api/v1/questionnaire")
                        .queryParam("service_code", serviceCode)
                        .queryParam("plan_id", planId)
                        .queryParam("tenant_id", tenantId)
                        .build())
                .retrieve()
                .bodyToMono(String.class)
                .block(Duration.ofSeconds(15));
    }
}
