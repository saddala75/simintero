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
                "https://artifacts.simintero.io/shared/cql_library/knee-arthroscopy", "1.0.0", null, null, List.of())));
        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"service_code\":\"27447\",\"procedure_code\":\"27447\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.pa_required").value(true))
           .andExpect(jsonPath("$.pins[0]").value("urn:sim:policy:knee-arthroscopy:1.0.0"))
           .andExpect(jsonPath("$.dtr_package_ref").value("urn:sim:dtr:knee-arthroscopy:1.0.0"))
           .andExpect(jsonPath("$.governing_rules[0].version").value("1.0.0"));
    }

    @Test
    void resolvesNonKneeRuleDataDriven() throws Exception {
        when(ruleResolver.resolveByProcedure(eq("72148"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("72148"), true,
                List.of("urn:sim:policy:lumbar-spine-mri:1.0.0"),
                "urn:sim:dtr:lumbar-spine-mri:1.0.0",
                List.of(Map.of("requirement_id","conservative_therapy_6wk","required",true)),
                "https://artifacts.simintero.io/shared/cql_library/lumbar-spine-mri", "1.0.0", null, null, List.of())));
        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"service_code\":\"72148\",\"procedure_code\":\"72148\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.pa_required").value(true))
           .andExpect(jsonPath("$.pins[0]").value("urn:sim:policy:lumbar-spine-mri:1.0.0"))
           .andExpect(jsonPath("$.dtr_package_ref").value("urn:sim:dtr:lumbar-spine-mri:1.0.0"))
           .andExpect(jsonPath("$.governing_rules[0].rule_id").value("coverage_rule/72148"));
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

    @Test
    void conflictingProcedureCodesReturn409() throws Exception {
        when(ruleResolver.resolveByProcedure(eq("27447"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("27447"), true, List.of(), "urn:sim:dtr:knee-arthroscopy:1.0.0",
                List.of(), null, "1.0.0", null, null, List.of())));
        when(ruleResolver.resolveByProcedure(eq("72148"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("72148"), true, List.of(), "urn:sim:dtr:lumbar-spine-mri:1.0.0",
                List.of(), null, "1.0.0", null, null, List.of())));

        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"procedure_codes\":[\"27447\",\"72148\"]}"))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.error").value("SIM-DIG-CONFLICT"))
           .andExpect(jsonPath("$.conflicting_codes").isArray())
           .andExpect(jsonPath("$.conflicting_codes.length()").value(2));
    }

    @Test
    void oneConflictingOneNotReturnsNormalResponse() throws Exception {
        when(ruleResolver.resolveByProcedure(eq("27447"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("27447"), true, List.of("urn:sim:policy:knee-arthroscopy:1.0.0"),
                "urn:sim:dtr:knee-arthroscopy:1.0.0", List.of(), null, "1.0.0", null, null, List.of())));
        when(ruleResolver.resolveByProcedure(eq("99213"), any(RuleContext.class)))
            .thenReturn(Optional.empty());

        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"procedure_codes\":[\"27447\",\"99213\"]}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.pa_required").value(true))
           .andExpect(jsonPath("$.pins[0]").value("urn:sim:policy:knee-arthroscopy:1.0.0"));
    }

    @Test
    void singleEntryProcedureCodesListBehavesLikeSingleCode() throws Exception {
        when(ruleResolver.resolveByProcedure(eq("27447"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("27447"), true, List.of("urn:sim:policy:knee-arthroscopy:1.0.0"),
                "urn:sim:dtr:knee-arthroscopy:1.0.0", List.of(), null, "1.0.0", null, null, List.of())));

        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"procedure_codes\":[\"27447\"]}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.pa_required").value(true));
    }

    @Test
    void ncdNonCoveredReturnsPaFalseWithCoverageIndicator() throws Exception {
        when(ruleResolver.resolveByProcedure(eq("22857"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("22857"), false, List.of(), null, List.of(),
                null, null, "ncd", "non_covered", List.of())));
        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"service_code\":\"22857\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.pa_required").value(false))
           .andExpect(jsonPath("$.coverage_indicator").value("non_covered"))
           .andExpect(jsonPath("$.governing_rules[0].source_type").value("ncd"));
    }

    @Test
    void ncdCoveredWithLimitationsReturnsPaTrue() throws Exception {
        when(ruleResolver.resolveByProcedure(eq("27447"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("27447"), true, List.of(), null, List.of(),
                null, null, "ncd", "covered_with_limitations", List.of())));
        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"service_code\":\"27447\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.pa_required").value(true))
           .andExpect(jsonPath("$.coverage_indicator").value("covered_with_limitations"))
           .andExpect(jsonPath("$.governing_rules[0].source_type").value("ncd"));
    }

    @Test
    void ncdCoveredReturnsPaFalseWithNcdInGoverningRules() throws Exception {
        when(ruleResolver.resolveByProcedure(eq("99213"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("99213"), false, List.of(), null, List.of(),
                null, null, "ncd", "covered", List.of())));
        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"service_code\":\"99213\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.pa_required").value(false))
           .andExpect(jsonPath("$.coverage_indicator").value("covered"))
           .andExpect(jsonPath("$.governing_rules[0].source_type").value("ncd"));
    }

    @Test
    void payerRuleWithNcdRelationIncludesNcdInGoverningRules() throws Exception {
        List<Map<String, Object>> relations = List.of(
            Map.of("rel", "supplements", "target", "urn:cms:ncd:procedure:27447", "source_type", "ncd"));
        when(ruleResolver.resolveByProcedure(eq("27447"), any(RuleContext.class)))
            .thenReturn(Optional.of(new CoverageRule(
                List.of("27447"), true,
                List.of("urn:sim:policy:knee-arthroscopy:1.0.0"),
                "urn:sim:dtr:knee-arthroscopy:1.0.0", List.of(),
                "https://artifacts.simintero.io/shared/cql_library/knee-arthroscopy", "1.0.0",
                "internal_supplement", null, relations)));
        mvc.perform(post("/v1/runtime/coverage-discovery").contentType("application/json")
                .content("{\"service_code\":\"27447\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.pa_required").value(true))
           .andExpect(jsonPath("$.governing_rules.length()").value(2))
           .andExpect(jsonPath("$.governing_rules[0].source_type").value("internal_supplement"))
           .andExpect(jsonPath("$.governing_rules[1].source_type").value("ncd"))
           .andExpect(jsonPath("$.governing_rules[1].rule_id").value("urn:cms:ncd:procedure:27447"));
    }
}
