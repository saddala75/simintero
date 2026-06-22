package io.simintero.digicore.runtime.config;

import ca.uhn.fhir.context.FhirContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Provides a singleton FHIR R4 {@link FhirContext}.
 *
 * <p>{@code FhirContext.forR4()} is expensive to construct (it scans and indexes the
 * R4 structure definitions) but is thread-safe once built, so it is created exactly
 * once and shared across the application as a Spring bean.</p>
 */
@Configuration
public class FhirConfig {

    @Bean
    public FhirContext fhirContext() {
        return FhirContext.forR4();
    }
}
