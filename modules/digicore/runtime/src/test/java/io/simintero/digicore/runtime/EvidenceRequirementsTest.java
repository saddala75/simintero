package io.simintero.digicore.runtime;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration test for the evidence-requirements:resolve endpoint.
 *
 * The endpoint is now data-driven (resolves coverage_rule artifacts via
 * RuleResolver). In the bare Spring context no rule artifacts are seeded,
 * so every service_code resolves to empty requirements while the response
 * shape ({service_code, requirements}) is preserved.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class EvidenceRequirementsTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void unseededServiceCode_returnsEmptyRequirementsWithShapePreserved() throws Exception {
        String body = """
                {
                  "service_code": "knee_arthroscopy"
                }
                """;

        mockMvc.perform(post("/v1/runtime/evidence-requirements:resolve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.service_code").value("knee_arthroscopy"))
                .andExpect(jsonPath("$.requirements", hasSize(0)));
    }

    @Test
    void unknownServiceCode_returnsEmptyRequirements() throws Exception {
        String body = """
                {
                  "service_code": "unknown_procedure"
                }
                """;

        mockMvc.perform(post("/v1/runtime/evidence-requirements:resolve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requirements", hasSize(0)));
    }
}
