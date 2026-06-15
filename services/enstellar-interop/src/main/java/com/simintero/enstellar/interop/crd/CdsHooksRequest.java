package com.simintero.enstellar.interop.crd;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.Map;

/** CDS Hooks 2.0 invoke request body (only the fields CRD consumes). */
@JsonIgnoreProperties(ignoreUnknown = true)
public record CdsHooksRequest(
        String hook,
        String hookInstance,
        Map<String, Object> context,
        Map<String, Object> prefetch,
        Object fhirAuthorization) {}
