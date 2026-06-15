package com.simintero.enstellar.interop.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "interop.hapi")
public class HapiProperties {

    /** Base URL of the external HAPI FHIR container, e.g. http://hapi:8080/fhir */
    private String baseUrl;

    /**
     * When true, FhirProxyFilter forwards all /fhir/** CRUD to the external HAPI container.
     * Default false so existing ITs using the embedded RestfulServer continue to work.
     * Set to true only when a real HAPI JPA container is reachable (production, conformance tests).
     */
    private boolean proxyEnabled = false;

    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String url) { this.baseUrl = url; }

    public boolean isProxyEnabled() { return proxyEnabled; }
    public void setProxyEnabled(boolean proxyEnabled) { this.proxyEnabled = proxyEnabled; }
}
