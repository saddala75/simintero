package io.simintero.digicore.runtime.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.simintero.digicore.runtime.engine.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(MeasureEvaluateController.class)
class MeasureEvaluateControllerTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @MockBean CqfEvaluator cqfEvaluator;
    @MockBean RuleResolver ruleResolver;

    private static final String CQL = "library BcsE version '1.0.0' define \"Meets All Criteria\": true";

    @Test
    void returnsBooleanPopulationsForEachMember() throws Exception {
        when(ruleResolver.resolveCql(anyString(), isNull(), any()))
            .thenReturn(Optional.of(CQL));
        when(cqfEvaluator.evaluate(eq(CQL), any(), eq("t1"), eq("m1"), isNull()))
            .thenReturn(new ElmEvaluator.ElmResult("meets_all", List.of(), List.of(
                Map.of("step", "Denominator", "result", "true"),
                Map.of("step", "Numerator",   "result", "true"),
                Map.of("step", "Exclusion",   "result", "false"),
                Map.of("step", "Exception",   "result", "false"),
                Map.of("step", "Meets All Criteria", "result", "true")
            )));
        when(cqfEvaluator.evaluate(eq(CQL), any(), eq("t1"), eq("m2"), isNull()))
            .thenReturn(new ElmEvaluator.ElmResult("not_met", List.of(), List.of(
                Map.of("step", "Denominator", "result", "true"),
                Map.of("step", "Numerator",   "result", "false"),
                Map.of("step", "Exclusion",   "result", "false"),
                Map.of("step", "Exception",   "result", "false"),
                Map.of("step", "Meets All Criteria", "result", "false")
            )));

        var req = Map.of(
            "tenantId", "t1",
            "libraryRef", "https://artifacts.simintero.io/shared/cql_library/bcs-e",
            "memberRefs", List.of("m1", "m2"),
            "periodStart", "2025-01-01",
            "periodEnd", "2025-12-31"
        );

        mvc.perform(post("/v1/runtime/measure-evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(req)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].memberRef").value("m1"))
            .andExpect(jsonPath("$.results[0].numerator").value(true))
            .andExpect(jsonPath("$.results[1].memberRef").value("m2"))
            .andExpect(jsonPath("$.results[1].numerator").value(false));
    }

    @Test
    void missingExpressionDefaultsToFalse() throws Exception {
        when(ruleResolver.resolveCql(anyString(), isNull(), any()))
            .thenReturn(Optional.of(CQL));
        // Only "Meets All Criteria" in logicPath — no Denominator/Numerator/etc
        when(cqfEvaluator.evaluate(eq(CQL), any(), anyString(), anyString(), isNull()))
            .thenReturn(new ElmEvaluator.ElmResult("meets_all", List.of(), List.of(
                Map.of("step", "Meets All Criteria", "result", "true")
            )));

        var req = Map.of("tenantId", "t1", "libraryRef", "url",
            "memberRefs", List.of("m1"), "periodStart", "2025-01-01", "periodEnd", "2025-12-31");

        mvc.perform(post("/v1/runtime/measure-evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(req)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].denominator").value(false))
            .andExpect(jsonPath("$.results[0].numerator").value(false));
    }

    @Test
    void returns404WhenLibraryNotFound() throws Exception {
        when(ruleResolver.resolveCql(anyString(), isNull(), any()))
            .thenReturn(Optional.empty());

        var req = Map.of("tenantId", "t1", "libraryRef", "url",
            "memberRefs", List.of("m1"), "periodStart", "2025-01-01", "periodEnd", "2025-12-31");

        mvc.perform(post("/v1/runtime/measure-evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(req)))
            .andExpect(status().isNotFound());
    }

    @Test
    void returns400WhenMemberRefsEmpty() throws Exception {
        when(ruleResolver.resolveCql(anyString(), isNull(), any()))
            .thenReturn(Optional.of(CQL));

        var req = Map.of("tenantId", "t1", "libraryRef", "url",
            "memberRefs", List.of(), "periodStart", "2025-01-01", "periodEnd", "2025-12-31");

        mvc.perform(post("/v1/runtime/measure-evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(req)))
            .andExpect(status().isBadRequest());
    }

    @Test
    void indeterminateResultAllFalse() throws Exception {
        when(ruleResolver.resolveCql(anyString(), isNull(), any()))
            .thenReturn(Optional.of(CQL));
        when(cqfEvaluator.evaluate(any(), any(), anyString(), anyString(), isNull()))
            .thenReturn(new ElmEvaluator.ElmResult("indeterminate", List.of(), List.of()));

        var req = Map.of("tenantId", "t1", "libraryRef", "url",
            "memberRefs", List.of("m1"), "periodStart", "2025-01-01", "periodEnd", "2025-12-31");

        mvc.perform(post("/v1/runtime/measure-evaluate")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(req)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].denominator").value(false))
            .andExpect(jsonPath("$.results[0].numerator").value(false));
    }
}
