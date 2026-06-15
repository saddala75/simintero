package com.simintero.enstellar.interop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;

import java.util.List;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

class PatientResourceIT extends FhirTestBase {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TENANT = "patient-it-tenant";

    @BeforeEach
    void stubHapiPatients() {
        HAPI_MOCK.stubFor(post(urlEqualTo("/fhir/Patient"))
            .willReturn(aResponse().withStatus(201)
                .withHeader("Content-Type", "application/fhir+json")
                .withHeader("Location", "http://localhost/fhir/Patient/patient-read-001")
                .withBody("""
                    {"resourceType":"Patient","id":"patient-read-001",
                     "meta":{"security":[
                       {"system":"https://enstellar.simintero.com/tenants",
                        "code":"patient-it-tenant"}
                     ]},
                     "name":[{"family":"Smith","given":["Alice"]}],
                     "gender":"female","birthDate":"1985-03-22"}
                    """)));

        HAPI_MOCK.stubFor(get(urlEqualTo("/fhir/Patient/patient-read-001"))
            .willReturn(okJson("""
                {"resourceType":"Patient","id":"patient-read-001",
                 "meta":{"security":[
                   {"system":"https://enstellar.simintero.com/tenants",
                    "code":"patient-it-tenant"}
                 ]},
                 "name":[{"family":"Smith","given":["Alice"]}],
                 "gender":"female","birthDate":"1985-03-22"}
                """)));

        HAPI_MOCK.stubFor(get(urlMatching("/fhir/Patient\\?.*family=Jones.*"))
            .willReturn(okJson("""
                {"resourceType":"Bundle","entry":[{
                  "resource":{"resourceType":"Patient","id":"p-jones",
                    "name":[{"family":"Jones","given":["Bob"]}]}
                }]}
                """)));

        HAPI_MOCK.stubFor(get(urlMatching("/fhir/Patient\\?.*MRN-TAYLOR-01.*"))
            .willReturn(okJson("""
                {"resourceType":"Bundle","entry":[{
                  "resource":{"resourceType":"Patient","id":"p-taylor",
                    "identifier":[{"system":"http://example.org/mrn","value":"MRN-TAYLOR-01"}],
                    "name":[{"family":"Taylor","given":["David"]}]}
                }]}
                """)));

        HAPI_MOCK.stubFor(get(urlMatching("/fhir/Patient\\?.*"))
            .atPriority(9)
            .willReturn(okJson("{\"resourceType\":\"Bundle\",\"entry\":[]}")));
    }

    @Test
    void create_and_read_patient_by_id() throws Exception {
        HttpHeaders headers = fhirHeaders(mintJwt(TENANT, "patient/*.read patient/*.write"));

        String patientJson = """
                {
                  "resourceType": "Patient",
                  "meta": {"profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"]},
                  "identifier": [{"system": "http://example.org/mrn", "value": "MRN-READ-001"}],
                  "name": [{"family": "Smith", "given": ["Alice"]}],
                  "gender": "female",
                  "birthDate": "1985-03-22"
                }
                """;

        ResponseEntity<String> createResponse = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.POST,
                new HttpEntity<>(patientJson, headers),
                String.class);
        assertThat(createResponse.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        String location = createResponse.getHeaders().getFirst("Location");
        assertThat(location).isNotNull();
        String id = extractId(location, "Patient");

        ResponseEntity<String> readResponse = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient/" + id,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);
        assertThat(readResponse.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode patient = JSON.readTree(readResponse.getBody());
        assertThat(patient.path("resourceType").asText()).isEqualTo("Patient");
        assertThat(patient.path("name").path(0).path("family").asText()).isEqualTo("Smith");
    }

    @Test
    void search_patient_by_family_name() throws Exception {
        HttpHeaders headers = fhirHeaders(mintJwt(TENANT, "patient/*.read patient/*.write"));

        createPatient(headers, "Jones", "Bob", "MRN-JONES-01");
        createPatient(headers, "Williams", "Carol", "MRN-WILLIAMS-01");

        ResponseEntity<String> searchResponse = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient?family=Jones",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);
        assertThat(searchResponse.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode bundle = JSON.readTree(searchResponse.getBody());
        assertThat(bundle.path("resourceType").asText()).isEqualTo("Bundle");
        for (JsonNode entry : bundle.path("entry")) {
            String family = entry.path("resource").path("name").path(0).path("family").asText();
            assertThat(family).isEqualTo("Jones");
        }
    }

    @Test
    void search_patient_by_identifier() throws Exception {
        HttpHeaders headers = fhirHeaders(mintJwt(TENANT, "patient/*.read patient/*.write"));

        createPatient(headers, "Taylor", "David", "MRN-TAYLOR-01");

        ResponseEntity<String> searchResponse = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient?identifier=http://example.org/mrn|MRN-TAYLOR-01",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);
        assertThat(searchResponse.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode bundle = JSON.readTree(searchResponse.getBody());
        boolean found = false;
        for (JsonNode entry : bundle.path("entry")) {
            for (JsonNode idNode : entry.path("resource").path("identifier")) {
                if ("MRN-TAYLOR-01".equals(idNode.path("value").asText())) {
                    found = true;
                }
            }
        }
        assertThat(found).as("Patient MRN-TAYLOR-01 should appear in search results").isTrue();
    }

    private HttpHeaders fhirHeaders(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(token);
        h.setContentType(MediaType.valueOf("application/fhir+json"));
        h.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        return h;
    }

    private void createPatient(HttpHeaders headers, String family, String given, String mrn) {
        String json = """
                {
                  "resourceType": "Patient",
                  "identifier": [{"system": "http://example.org/mrn", "value": "%s"}],
                  "name": [{"family": "%s", "given": ["%s"]}],
                  "gender": "unknown",
                  "birthDate": "2000-01-01"
                }
                """.formatted(mrn, family, given);
        restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.POST,
                new HttpEntity<>(json, headers),
                String.class);
    }

    private String extractId(String location, String resourceType) {
        String[] segments = location.split("/");
        for (int i = 0; i < segments.length - 1; i++) {
            if (resourceType.equals(segments[i])) {
                return segments[i + 1];
            }
        }
        throw new IllegalArgumentException("Cannot extract ID from Location: " + location);
    }
}
