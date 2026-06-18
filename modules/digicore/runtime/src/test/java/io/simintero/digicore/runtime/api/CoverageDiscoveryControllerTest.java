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

@WebMvcTest(CoverageDiscoveryController.class)
class CoverageDiscoveryControllerTest {

    @Autowired MockMvc mvc;
    @MockBean RuleResolver ruleResolver;

    @Test
    void resolvedRuleReturnsPaRequiredWithPinsAndDtr() throws Exception {
        when(ruleResolver.resolveByProcedure(eq("27447"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("27447"), true,
                List.of("urn:sim:policy:knee-arthroscopy:1.0.0"),
                "urn:sim:dtr:knee-arthroscopy:1.0.0",
                List.of(Map.of("requirement_id","diagnosis_documented","required",true)),
                "https://artifacts.simintero.io/shared/cql_library/knee-arthroscopy", "1.0.0")));
        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"service_code\":\"27447\",\"procedure_code\":\"27447\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.pa_required").value(true))
           .andExpect(jsonPath("$.pins[0]").value("urn:sim:policy:knee-arthroscopy:1.0.0"))
           .andExpect(jsonPath("$.dtr_package_ref").value("urn:sim:dtr:knee-arthroscopy:1.0.0"))
           .andExpect(jsonPath("$.governing_rules[0].version").value("1.0.0"));
    }

    @Test
    void unknownCodeReturnsPaNotRequired() throws Exception {
        when(ruleResolver.resolveByProcedure(any(), any(RuleContext.class))).thenReturn(Optional.empty());
        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"service_code\":\"99999\",\"procedure_code\":\"99999\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.pa_required").value(false))
           .andExpect(jsonPath("$.governing_rules").isArray())
           .andExpect(jsonPath("$.pins").isArray());
    }
}
