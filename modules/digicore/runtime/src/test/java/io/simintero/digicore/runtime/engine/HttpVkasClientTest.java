package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;
import org.hamcrest.Matchers;

class HttpVkasClientTest {

    @Test
    void resolveContentReturnsContentOn200() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        HttpVkasClient client = new HttpVkasClient(builder, "http://vkas:3040");
        server.expect(requestTo(Matchers.allOf(
                Matchers.containsString("/v1/artifacts:resolve"),
                Matchers.containsString("canonical_url=https://artifacts.simintero.io/shared/coverage_rule/27447"))))
            .andRespond(withSuccess(
                "{\"status\":\"active\",\"content\":{\"pa_required\":true,\"procedure_codes\":[\"27447\"]}}",
                MediaType.APPLICATION_JSON));
        Optional<JsonNode> content = client.resolveContent(
            "https://artifacts.simintero.io/shared/coverage_rule/27447", null, RuleContext.empty());
        assertTrue(content.isPresent());
        assertTrue(content.get().path("pa_required").asBoolean());
        server.verify();
    }

    @Test
    void resolveContentEmptyOn404() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        HttpVkasClient client = new HttpVkasClient(builder, "http://vkas:3040");
        server.expect(requestTo(Matchers.containsString("/v1/artifacts:resolve")))
            .andRespond(withStatus(HttpStatus.NOT_FOUND).body("{\"error\":\"nf\"}").contentType(MediaType.APPLICATION_JSON));
        assertTrue(client.resolveContent(
            "https://artifacts.simintero.io/shared/coverage_rule/99999", null, RuleContext.empty()).isEmpty());
    }

    @Test
    void resolveContentDoesNotUrlEncodeTheResolveColon() {
        // The VKAS route is a literal /v1/artifacts:resolve — the ':' must reach VKAS un-encoded.
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        HttpVkasClient client = new HttpVkasClient(builder, "http://vkas:3040");
        server.expect(requestTo(Matchers.containsString("artifacts:resolve")))  // not artifacts%3Aresolve
            .andRespond(withSuccess("{\"status\":\"active\",\"content\":{}}", MediaType.APPLICATION_JSON));
        client.resolveContent("https://artifacts.simintero.io/shared/cql_library/x", "1.0.0", RuleContext.empty());
        server.verify();
    }
}
