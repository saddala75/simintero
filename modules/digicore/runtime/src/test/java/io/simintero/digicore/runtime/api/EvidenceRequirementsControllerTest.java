package io.simintero.digicore.runtime.api;

import io.simintero.digicore.runtime.engine.CoverageRule;
import io.simintero.digicore.runtime.engine.RuleContext;
import io.simintero.digicore.runtime.engine.RuleResolver;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(EvidenceRequirementsController.class)
class EvidenceRequirementsControllerTest {

    @Autowired MockMvc mvc;
    @MockBean RuleResolver ruleResolver;

    @Test
    void returnsRuleEvidenceRequirementsForNonKneeCode() throws Exception {
        when(ruleResolver.resolveByProcedure(eq("72148"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("72148"), true, List.of(), null,
                List.of(
                    Map.of("requirement_id","conservative_therapy_6wk","display","Conservative therapy 6wk","required",true),
                    Map.of("requirement_id","neuro_deficit_or_red_flag","display","Neuro deficit or red flag","required",true)),
                "https://artifacts.simintero.io/shared/cql_library/lumbar-spine-mri", "1.0.0")));
        mvc.perform(post("/v1/runtime/evidence-requirements:resolve").contentType("application/json")
                .content("{\"service_code\":\"72148\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.requirements[0].requirement_id").value("conservative_therapy_6wk"))
           .andExpect(jsonPath("$.requirements[1].requirement_id").value("neuro_deficit_or_red_flag"))
           .andExpect(jsonPath("$.requirements.length()").value(2));
    }

    @Test
    void unknownCodeReturnsEmptyRequirements() throws Exception {
        when(ruleResolver.resolveByProcedure(any(), any(RuleContext.class))).thenReturn(Optional.empty());
        mvc.perform(post("/v1/runtime/evidence-requirements:resolve").contentType("application/json")
                .content("{\"service_code\":\"99999\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.requirements").isArray())
           .andExpect(jsonPath("$.requirements.length()").value(0));
    }
}
