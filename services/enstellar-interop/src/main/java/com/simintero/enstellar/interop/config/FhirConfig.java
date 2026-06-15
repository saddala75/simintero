package com.simintero.enstellar.interop.config;

import ca.uhn.fhir.context.FhirContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Explicitly declares the HAPI FhirContext bean (R4) so that it is available
 * for injection by InterceptorConfig and any future HAPI-aware components.
 *
 * Declaring this explicitly (rather than relying solely on HAPI's Spring Boot
 * auto-configuration) keeps the dependency visible and makes test contexts
 * load correctly without requiring a full HAPI JPA database setup.
 */
@Configuration
public class FhirConfig {

    @Bean
    public FhirContext fhirContext() {
        return FhirContext.forR4();
    }
}
