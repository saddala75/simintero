package com.simintero.enstellar.interop.dtr;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.FhirTestBase;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

@Tag("integration")
class DtrLaunchIT extends FhirTestBase {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void launch_returns_renderer_context_unauthenticated() throws Exception {
        ResponseEntity<String> resp = restTemplate.getForEntity(
                "http://localhost:" + port + "/dtr/launch?iss=http://ehr/fhir&launch=abc123",
                String.class);

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode body = JSON.readTree(resp.getBody());
        assertThat(body.path("renderer").asText()).isEqualTo("/dtr");
        assertThat(body.path("launch").asText()).isEqualTo("abc123");
    }
}
