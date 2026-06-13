package io.simintero.fhir.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Holds CapabilityStatement metadata populated from ig-lock.json values.
 * IG versions are sourced from contracts/fhir/ig-lock.json and kept in
 * sync here for Phase 1. A future task may load these dynamically.
 */
@Component
public class CapabilityConfig {

    // IG versions from contracts/fhir/ig-lock.json
    public static final String PAS_IG_VERSION = "2.0.1";
    public static final String US_CORE_VERSION = "6.1.0";
    public static final String CRD_IG_VERSION = "2.0.1";
    public static final String FHIR_VERSION = "4.0.1";

    // Implementation guide canonical URLs
    public static final String PAS_IG_URL =
            "http://hl7.org/fhir/us/davinci-pas/ImplementationGuide/hl7.fhir.us.davinci-pas|" + PAS_IG_VERSION;
    public static final String US_CORE_URL =
            "http://hl7.org/fhir/us/core/ImplementationGuide/hl7.fhir.us.core|" + US_CORE_VERSION;

    @Value("${fhir.implementation.url:https://simintero.io/fhir}")
    private String implementationUrl;

    public String getImplementationUrl() {
        return implementationUrl;
    }
}
