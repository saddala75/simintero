package io.simintero.fhir.config;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.api.EncodingEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.server.HardcodedServerAddressStrategy;
import ca.uhn.fhir.rest.server.RestfulServer;
import ca.uhn.fhir.rest.server.provider.ServerCapabilityStatementProvider;
import io.simintero.fhir.pas.PasProvider;
import jakarta.servlet.http.HttpServletRequest;
import org.hl7.fhir.instance.model.api.IBaseConformance;
import org.hl7.fhir.r4.model.CapabilityStatement;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

/**
 * HAPI FHIR RestfulServer wiring.
 * Registers the FHIR R4 servlet at /fhir/* on port 8080 (embedded Tomcat).
 * The servlet exposes Da Vinci PAS operations via PasProvider.
 */
@Configuration
public class FhirServerConfig {

    @Bean
    public FhirContext fhirContext() {
        return FhirContext.forR4();
    }

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    @Bean
    public RestfulServer fhirRestfulServer(
            FhirContext fhirContext,
            PasProvider pasProvider,
            CapabilityConfig capabilityConfig) {

        RestfulServer server = new RestfulServer(fhirContext);

        // Register PAS resource provider (Claim operations)
        server.registerProvider(pasProvider);

        // Hard-code the server base URL so CapabilityStatement.implementation.url is set
        server.setServerAddressStrategy(
                new HardcodedServerAddressStrategy(capabilityConfig.getImplementationUrl()));

        // Default to JSON responses
        server.setDefaultResponseEncoding(EncodingEnum.JSON);

        // Populate CapabilityStatement with IG references from ig-lock.json
        server.setImplementationDescription("Simintero FHIR Facade — Da Vinci PAS " +
                CapabilityConfig.PAS_IG_VERSION);

        // Wire PAS + US Core IG canonical URLs into the CapabilityStatement
        ServerCapabilityStatementProvider conformanceProvider =
                new ServerCapabilityStatementProvider(server) {
                    @Override
                    public IBaseConformance getServerConformance(
                            HttpServletRequest theRequest, RequestDetails theRequestDetails) {
                        IBaseConformance conf =
                                super.getServerConformance(theRequest, theRequestDetails);
                        if (conf instanceof CapabilityStatement cs) {
                            cs.addImplementationGuide(CapabilityConfig.PAS_IG_URL);
                            cs.addImplementationGuide(CapabilityConfig.US_CORE_URL);
                        }
                        return conf;
                    }
                };
        server.setServerConformanceProvider(conformanceProvider);

        return server;
    }

    @Bean
    public ServletRegistrationBean<RestfulServer> fhirServlet(RestfulServer fhirRestfulServer) {
        ServletRegistrationBean<RestfulServer> registration =
                new ServletRegistrationBean<>(fhirRestfulServer, "/fhir/*");
        registration.setLoadOnStartup(1);
        return registration;
    }
}
