package com.simintero.enstellar.interop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.Network;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test: verifies that hapiproject/hapi:v7.4.0 correctly loads US Core 5.0.1
 * and Da Vinci PAS 2.0.1 IGs and enforces profile validation.
 *
 * Requires outbound internet access (packages.fhir.org) on first run.
 * Tag "integration" — excluded from the default test task; run with:
 *   ./gradlew test -PincludeIntegration --tests "*.HapiIgLoadIT"
 */
@Tag("integration")
@Testcontainers
class HapiIgLoadIT {

    private static final ObjectMapper JSON = new ObjectMapper();
    static final Network NETWORK = Network.newNetwork();

    @Container
    static final PostgreSQLContainer<?> HAPI_DB = new PostgreSQLContainer<>(
        DockerImageName.parse("postgres:16-alpine"))
        .withDatabaseName("hapi")
        .withUsername("hapi")
        .withPassword("hapi_test")
        .withNetwork(NETWORK)
        .withNetworkAliases("hapi-db");

    @Container
    static final GenericContainer<?> HAPI = new GenericContainer<>(
        DockerImageName.parse("hapiproject/hapi:v7.4.0"))
        .withNetwork(NETWORK)
        .withExposedPorts(8080)
        .withEnv("spring.datasource.url",
            "jdbc:postgresql://hapi-db:5432/hapi")
        .withEnv("spring.datasource.username", "hapi")
        .withEnv("spring.datasource.password", "hapi_test")
        .withEnv("spring.datasource.driverClassName", "org.postgresql.Driver")
        .withEnv("spring.jpa.properties.hibernate.dialect",
            "ca.uhn.fhir.jpa.model.dialect.HapiFhirPostgres94Dialect")
        .withEnv("hapi.fhir.fhir_version", "R4")
        .withEnv("hapi.fhir.validation.requests_enabled", "true")
        .withEnv("hapi.fhir.implementationguides[0].name", "hl7.fhir.us.core")
        .withEnv("hapi.fhir.implementationguides[0].version", "5.0.1")
        .withEnv("hapi.fhir.implementationguides[1].name", "hl7.fhir.us.davinci-pas")
        .withEnv("hapi.fhir.implementationguides[1].version", "2.0.1")
        .dependsOn(HAPI_DB)
        // HAPI binds port 8080 (Tomcat) well before the server can serve requests
        // (IG indexing + JPA init takes ~45-60s). The default listening-port wait
        // strategy returns too early and the first FHIR request gets "connection
        // reset". Wait until /fhir/metadata actually answers 200 before tests run.
        .waitingFor(Wait.forHttp("/fhir/metadata")
            .forStatusCode(200)
            .withStartupTimeout(java.time.Duration.ofMinutes(5)))
        .withStartupTimeout(java.time.Duration.ofMinutes(5));

    private String hapiUrl() {
        return "http://localhost:" + HAPI.getMappedPort(8080) + "/fhir";
    }

    private HttpHeaders fhirHeaders() {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.valueOf("application/fhir+json"));
        h.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        return h;
    }

    /**
     * RestTemplate that never throws on non-2xx responses, so tests can assert on
     * the returned status code directly. The default RestTemplate raises
     * HttpClientErrorException on 4xx (e.g. HAPI's 422 validation rejections),
     * which would short-circuit the assertions below.
     */
    private RestTemplate nonThrowingRestTemplate() {
        RestTemplate rt = new RestTemplate();
        rt.setErrorHandler(new DefaultResponseErrorHandler() {
            @Override
            public boolean hasError(ClientHttpResponse response) {
                return false;
            }
        });
        return rt;
    }

    @Test
    void hapi_starts_and_returns_capability_statement() throws Exception {
        RestTemplate rt = nonThrowingRestTemplate();
        ResponseEntity<String> response = rt.getForEntity(hapiUrl() + "/metadata", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode cs = JSON.readTree(response.getBody());
        assertThat(cs.path("resourceType").asText()).isEqualTo("CapabilityStatement");
    }

    @Test
    void valid_us_core_patient_is_accepted() {
        RestTemplate rt = nonThrowingRestTemplate();
        String patient = """
            {
              "resourceType": "Patient",
              "meta": {
                "profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"]
              },
              "identifier": [{"system": "http://hl7.org/fhir/sid/us-ssn", "value": "000-00-0001"}],
              "name": [{"family": "Test", "given": ["Conformance"],
                        "use": "official"}],
              "gender": "female",
              "birthDate": "1990-01-01"
            }
            """;

        ResponseEntity<String> response = rt.exchange(
            hapiUrl() + "/Patient",
            HttpMethod.POST,
            new HttpEntity<>(patient, fhirHeaders()),
            String.class);

        assertThat(response.getStatusCode().value())
            .as("Valid US Core Patient should be accepted (2xx)")
            .isBetween(200, 299);
    }

    @Test
    void patient_without_required_us_core_fields_returns_validation_error() {
        RestTemplate rt = nonThrowingRestTemplate();
        // Missing mandatory US Core fields: identifier, name, gender — should fail validation
        String barePatient = """
            {
              "resourceType": "Patient",
              "meta": {
                "profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"]
              }
            }
            """;

        ResponseEntity<String> response = rt.exchange(
            hapiUrl() + "/Patient",
            HttpMethod.POST,
            new HttpEntity<>(barePatient, fhirHeaders()),
            String.class);

        assertThat(response.getStatusCode().value())
            .as("Patient missing required US Core fields should return 4xx")
            .isBetween(400, 499);
    }
}
