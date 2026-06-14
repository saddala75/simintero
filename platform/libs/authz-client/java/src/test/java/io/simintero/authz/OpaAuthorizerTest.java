package io.simintero.authz;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class OpaAuthorizerTest {

  static HttpServer server;
  static int port;
  static final ObjectMapper MAPPER = new ObjectMapper();
  static final AtomicReference<String> lastBody = new AtomicReference<>();
  static volatile boolean allow = true;

  @BeforeAll
  static void start() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/data/sim/guards/adverse_action/allow", ex -> {
      lastBody.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
      byte[] body = ("{\"result\":" + allow + "}").getBytes(StandardCharsets.UTF_8);
      ex.sendResponseHeaders(200, body.length);
      ex.getResponseBody().write(body);
      ex.close();
    });
    server.start();
    port = server.getAddress().getPort();
  }

  @AfterAll
  static void stop() { server.stop(0); }

  private static final Principal P = new Principal("t_acme", List.of("medical_director"), "human");

  @Test
  void allowsWhenResultTrue() throws Exception {
    allow = true;
    new OpaAuthorizer("http://127.0.0.1:" + port)
        .authorize(Map.of("action", "decision.record", "resource", Map.of("outcome", "denied")), P);
    JsonNode sent = MAPPER.readTree(lastBody.get());
    JsonNode sim = sent.path("input").path("principal").path("sim");
    assertEquals("t_acme", sim.path("tenant_id").asText());
    assertEquals("human", sim.path("principal_type").asText());
    assertEquals("medical_director", sim.path("roles").get(0).asText());
  }

  @Test
  void deniesWhenResultFalse() {
    allow = false;
    ForbiddenException ex = assertThrows(ForbiddenException.class, () ->
        new OpaAuthorizer("http://127.0.0.1:" + port)
            .authorize(Map.of("action", "decision.record", "resource", Map.of()), P));
    assertEquals("SIM-AUTHZ-0001", ex.code());
    assertEquals(403, ex.status);
  }
}
