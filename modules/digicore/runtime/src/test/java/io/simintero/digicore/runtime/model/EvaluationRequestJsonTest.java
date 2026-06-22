package io.simintero.digicore.runtime.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Verifies {@link EvaluationRequest} binds BOTH the snake_case wire names (smoke/curl) AND the
 * camelCase names the Python connector posts, under the app's global SNAKE_CASE Jackson strategy
 * ({@code spring.jackson.property-naming-strategy=SNAKE_CASE}).
 */
class EvaluationRequestJsonTest {

    private final ObjectMapper mapper =
            new ObjectMapper().setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

    @Test void bindsCamelCaseFromPythonClient() throws Exception {
        String json = """
            {"caseId":"c1","serviceCode":"29827","member_ref":"member-001","tenant_id":"tenant-dev","pins":[],"evidence":{}}
            """;
        EvaluationRequest req = mapper.readValue(json, EvaluationRequest.class);
        assertEquals("c1", req.caseId());
        assertEquals("29827", req.serviceCode());
        assertEquals("member-001", req.memberRef());
        assertEquals("tenant-dev", req.tenantId());
    }

    @Test void bindsSnakeCaseFromSmokeCurl() throws Exception {
        String json = """
            {"case_id":"c1","service_code":"29827","member_ref":"member-001","tenant_id":"tenant-dev","pins":[],"evidence":{}}
            """;
        EvaluationRequest req = mapper.readValue(json, EvaluationRequest.class);
        assertEquals("c1", req.caseId());
        assertEquals("29827", req.serviceCode());
        assertEquals("member-001", req.memberRef());
        assertEquals("tenant-dev", req.tenantId());
    }
}
