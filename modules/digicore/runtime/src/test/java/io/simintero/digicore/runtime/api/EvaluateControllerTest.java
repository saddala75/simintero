package io.simintero.digicore.runtime.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.simintero.digicore.runtime.engine.*;
import io.simintero.digicore.runtime.trace.TraceBuilder;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(EvaluateController.class)
class EvaluateControllerTest {

    @Autowired MockMvc mvc;
    @MockBean RuleResolver ruleResolver;
    @MockBean PinResolver pinResolver;
    @MockBean TraceBuilder traceBuilder;
    @MockBean ElmEvaluator evaluator;

    private final ObjectMapper m = new ObjectMapper();

    @Test
    void evaluatesResolvedNonKneeRuleElm() throws Exception {
        when(pinResolver.resolve(any(), any())).thenReturn(List.of());
        when(traceBuilder.newTraceRef()).thenReturn("trace:1");
        when(traceBuilder.buildLogicPath(any())).thenReturn(List.of());
        var rule = new CoverageRule(List.of("72148"), true, List.of("urn:sim:policy:lumbar-spine-mri:1.0.0"),
            null, List.of(), "https://artifacts.simintero.io/shared/cql_library/lumbar-spine-mri", "1.0.0");
        when(ruleResolver.resolveByProcedure(eq("72148"), any(RuleContext.class))).thenReturn(Optional.of(rule));
        var elmNode = m.readTree("{\"library\":{\"statements\":{\"def\":[]}}}");
        when(ruleResolver.resolveElm(eq("https://artifacts.simintero.io/shared/cql_library/lumbar-spine-mri"), eq("1.0.0"), any()))
            .thenReturn(Optional.of(elmNode));
        when(evaluator.evaluate(any(), eq(elmNode)))
            .thenReturn(new ElmEvaluator.ElmResult("meets_all", List.of(), List.of()));

        mvc.perform(post("/v1/runtime/evaluate").contentType("application/json")
                .content("{\"case_id\":\"c1\",\"service_code\":\"72148\",\"pins\":[],\"evidence\":{\"a\":true}}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.outcome").value("meets_all"))
           .andExpect(jsonPath("$.auto_determination.eligible").value(true));
        // proves the RESOLVED elm was evaluated, NOT the default
        verify(evaluator).evaluate(any(), eq(elmNode));
        verify(evaluator, never()).evaluate(any());
    }

    @Test
    void abstainsWhenRuleUnresolved() throws Exception {
        when(pinResolver.resolve(any(), any())).thenReturn(List.of());
        when(traceBuilder.newTraceRef()).thenReturn("trace:1");
        when(traceBuilder.buildLogicPath(any())).thenReturn(List.of());
        when(ruleResolver.resolveByProcedure(any(), any())).thenReturn(Optional.empty());

        mvc.perform(post("/v1/runtime/evaluate").contentType("application/json")
                .content("{\"case_id\":\"c1\",\"service_code\":\"99999\",\"pins\":[],\"evidence\":{}}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.outcome").value("indeterminate"))
           .andExpect(jsonPath("$.auto_determination.eligible").value(false));
        verify(evaluator, never()).evaluate(any());          // never default-knee
        verify(evaluator, never()).evaluate(any(), any(com.fasterxml.jackson.databind.JsonNode.class));
    }
}
