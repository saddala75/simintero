package io.simintero.authz;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

/** OPA decision client — POSTs to /v1/data/{policy} and denies unless result == true,
 *  matching platform/libs/authz-client/ts/src/index.ts. */
public class OpaAuthorizer {

  public static final String DEFAULT_POLICY = "sim/guards/adverse_action/allow";

  private final String opaUrl;
  private final HttpClient http;
  private final ObjectMapper mapper = new ObjectMapper();

  public OpaAuthorizer(String opaUrl) {
    this.opaUrl = opaUrl;
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
  }

  /** Reads OPA_URL from the environment (default http://localhost:8181). */
  public OpaAuthorizer() {
    this(System.getenv().getOrDefault("OPA_URL", "http://localhost:8181"));
  }

  public void authorize(Map<String, Object> input, Principal principal) {
    authorize(input, principal, DEFAULT_POLICY);
  }

  public void authorize(Map<String, Object> input, Principal principal, String policy) {
    Map<String, Object> sim = new HashMap<>();
    sim.put("tenant_id", principal.tenantId());
    sim.put("roles", principal.roles());
    sim.put("principal_type", principal.principalType());

    Map<String, Object> inputObj = new HashMap<>(input);
    inputObj.put("principal", Map.of("sim", sim));
    Map<String, Object> payload = Map.of("input", inputObj);

    try {
      HttpRequest req = HttpRequest.newBuilder(URI.create(opaUrl + "/v1/data/" + policy))
          .timeout(Duration.ofSeconds(2))
          .header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))
          .build();
      HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
      if (resp.statusCode() != 200) {
        throw new RuntimeException("OPA unreachable: " + resp.statusCode());
      }
      boolean result = mapper.readTree(resp.body()).path("result").asBoolean(false);
      if (!result) {
        throw new ForbiddenException();
      }
    } catch (ForbiddenException e) {
      throw e;
    } catch (Exception e) {
      throw new RuntimeException("OPA decision call failed", e);
    }
  }
}
