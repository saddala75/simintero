package io.simintero.fhir;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Simintero FHIR Facade — Da Vinci PAS + CRD protocol adapter.
 * Converts inbound FHIR R4 requests into canonical IntakeCommand envelopes
 * and forwards them to the Enstellar intake service. No business logic here.
 */
@SpringBootApplication
public class FhirFacadeApplication {

    public static void main(String[] args) {
        SpringApplication.run(FhirFacadeApplication.class, args);
    }
}
