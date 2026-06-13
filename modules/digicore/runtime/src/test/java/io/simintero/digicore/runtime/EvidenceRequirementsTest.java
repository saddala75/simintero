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
 * Verifies that service_code=knee_arthroscopy returns exactly three requirements.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class EvidenceRequirementsTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void kneeArthroscopy_returnsThreeRequirements() throws Exception {
        String body = """
                {
                  "service_code": "knee_arthroscopy"
                }
                """;

        mockMvc.perform(post("/v1/runtime/evidence-requirements:resolve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requirements", hasSize(3)))
                .andExpect(jsonPath("$.requirements[*].requirement_id",
                        containsInAnyOrder(
                                "diagnosis_documented",
                                "conservative_therapy_tried",
                                "imaging_documented"
                        )));
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
