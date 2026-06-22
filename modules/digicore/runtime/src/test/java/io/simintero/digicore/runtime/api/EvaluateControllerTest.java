package io.simintero.digicore.runtime.api;

import io.simintero.digicore.runtime.engine.*;
import io.simintero.digicore.runtime.trace.TraceBuilder;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
    @MockBean CqfEvaluator cqfEvaluator;

    private static final String ELM_REF = "https://artifacts.simintero.io/shared/cql_library/lumbar-spine-mri";
    private static final String CQL = "library LumbarSpineMri version '1.0.0'\ndefine \"Meets All Criteria\": true";

    @Test
    void evaluatesResolvedRuleViaCqfEvaluator() throws Exception {
        when(pinResolver.resolve(any(), any())).thenReturn(List.of());
        when(traceBuilder.newTraceRef()).thenReturn("trace:1");
        when(traceBuilder.buildLogicPath(any())).thenReturn(List.of());
        var rule = new CoverageRule(List.of("72148"), true, List.of("urn:sim:policy:lumbar-spine-mri:1.0.0"),
            null, List.of(), ELM_REF, "1.0.0");
        when(ruleResolver.resolveByProcedure(eq("72148"), any(RuleContext.class))).thenReturn(Optional.of(rule));
        when(ruleResolver.resolveCql(eq(ELM_REF), eq("1.0.0"), any())).thenReturn(Optional.of(CQL));
        when(cqfEvaluator.evaluate(any(), any(), any(), any(), any()))
            .thenReturn(new ElmEvaluator.ElmResult("meets_all", List.of(), List.of()));

        mvc.perform(post("/v1/runtime/evaluate").contentType("application/json")
                .content("{\"case_id\":\"c1\",\"service_code\":\"72148\",\"pins\":[],\"evidence\":{\"a\":true}," +
                         "\"member_ref\":\"member-001\",\"tenant_id\":\"tenant-dev\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.outcome").value("meets_all"))
           .andExpect(jsonPath("$.auto_determination.eligible").value(true));

        // verify the controller threaded cqlText/evidence/tenantId/memberRef into the evaluator
        ArgumentCaptor<String> cqlCap = ArgumentCaptor.forClass(String.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> evidenceCap = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<String> tenantCap = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> memberCap = ArgumentCaptor.forClass(String.class);
        verify(cqfEvaluator).evaluate(cqlCap.capture(), evidenceCap.capture(),
            tenantCap.capture(), memberCap.capture(), isNull());
        assertEquals(CQL, cqlCap.getValue());
        assertEquals(Map.of("a", true), evidenceCap.getValue());
        assertEquals("tenant-dev", tenantCap.getValue());
        assertEquals("member-001", memberCap.getValue());
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
        verify(cqfEvaluator, never()).evaluate(any(), any(), any(), any(), any());
    }
}
