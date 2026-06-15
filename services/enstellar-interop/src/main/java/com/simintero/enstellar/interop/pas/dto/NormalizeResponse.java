package com.simintero.enstellar.interop.pas.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record NormalizeResponse(
    @JsonProperty("case_id") String caseId,
    @JsonProperty("tenant_id") String tenantId,
    @JsonProperty("correlation_id") String correlationId,
    @JsonProperty("status") String status,
    @JsonProperty("lob") String lob,
    @JsonProperty("_raw_bundle_key") String rawBundleKey
) {}
