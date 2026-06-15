package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.server.exceptions.InternalErrorException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.config.PasConfig;
import com.simintero.enstellar.interop.pas.dto.NormalizeRequest;
import com.simintero.enstellar.interop.pas.dto.NormalizeResponse;
import org.hl7.fhir.r4.model.Bundle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.time.Duration;

@Component
public class NormalizationClient {

    private static final Logger log = LoggerFactory.getLogger(NormalizationClient.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(30);

    private final WebClient webClient;
    private final FhirContext fhirContext;
    private final ObjectMapper objectMapper;

    public NormalizationClient(PasConfig config, FhirContext fhirContext, ObjectMapper objectMapper) {
        this.fhirContext = fhirContext;
        this.objectMapper = objectMapper;
        this.webClient = WebClient.builder()
            .baseUrl(config.normalizationUrl())
            .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
            .build();
    }

    public NormalizeResponse normalize(Bundle bundle, String tenantId, String correlationId) {
        String bundleJson = fhirContext.newJsonParser()
            .setPrettyPrint(false)
            .encodeResourceToString(bundle);

        Object bundleObj;
        try {
            bundleObj = objectMapper.readValue(bundleJson, Object.class);
        } catch (Exception e) {
            throw new InternalErrorException("Failed to serialize Bundle for normalization: " + e.getMessage(), e);
        }

        NormalizeRequest request = new NormalizeRequest(bundleObj, tenantId, correlationId);

        log.debug("normalize_request tenant={} correlation_id={}", tenantId, correlationId);

        try {
            NormalizeResponse response = webClient.post()
                .uri("/internal/normalize")
                .bodyValue(request)
                .retrieve()
                .bodyToMono(NormalizeResponse.class)
                .block(TIMEOUT);

            if (response == null) {
                throw new InternalErrorException("Normalization service returned empty response");
            }

            log.info("normalize_success tenant={} case_id={}", tenantId, response.caseId());
            return response;

        } catch (WebClientResponseException.UnprocessableEntity e) {
            throw new ca.uhn.fhir.rest.server.exceptions.InvalidRequestException(
                "Normalization rejected bundle: " + e.getResponseBodyAsString()
            );
        } catch (WebClientResponseException e) {
            throw new InternalErrorException(
                "Normalization service error (" + e.getStatusCode() + "): " + e.getResponseBodyAsString(), e
            );
        }
    }
}
