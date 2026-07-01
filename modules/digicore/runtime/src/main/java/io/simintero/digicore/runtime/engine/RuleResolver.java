package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RuleResolver {
    static final String COVERAGE_RULE_BASE = "https://artifacts.simintero.io/shared/coverage_rule/";
    static final String NCD_PROCEDURE_BASE = "urn:cms:ncd:procedure:";

    private final VkasClient vkas;
    private final CqlCompilerService compiler;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, JsonNode> elmCache = new ConcurrentHashMap<>();

    public RuleResolver(VkasClient vkas, CqlCompilerService compiler) {
        this.vkas = vkas;
        this.compiler = compiler;
    }

    public Optional<CoverageRule> resolveByProcedure(String procedureCode, RuleContext ctx) {
        if (procedureCode == null || procedureCode.isBlank()) return Optional.empty();
        Optional<CoverageRule> payer = vkas.resolveContent(COVERAGE_RULE_BASE + procedureCode, null, ctx).map(this::parse);
        if (payer.isPresent()) return payer;
        return vkas.resolveContent(NCD_PROCEDURE_BASE + procedureCode, null, ctx).map(this::parse);
    }

    @SuppressWarnings("unchecked")
    private CoverageRule parse(JsonNode c) {
        List<Map<String, Object>> reqs = new ArrayList<>();
        c.path("evidence_requirements").forEach(r -> reqs.add(mapper.convertValue(r, Map.class)));
        List<Map<String, Object>> relations = new ArrayList<>();
        c.path("relations").forEach(r -> relations.add(mapper.convertValue(r, Map.class)));
        JsonNode dtr = c.path("dtr_package_ref");
        JsonNode st = c.path("source_type");
        JsonNode ci = c.path("coverage_indicator");
        return new CoverageRule(
            list(c.path("procedure_codes")),
            c.path("pa_required").asBoolean(false),
            list(c.path("pins")),
            (dtr.isMissingNode() || dtr.isNull()) ? null : dtr.asText(),
            reqs,
            c.path("elm_ref").isMissingNode() ? null : c.path("elm_ref").asText(),
            c.path("elm_version").isMissingNode() ? null : c.path("elm_version").asText(),
            (st.isMissingNode() || st.isNull()) ? null : st.asText(),
            (ci.isMissingNode() || ci.isNull()) ? null : ci.asText(),
            relations);
    }

    private static List<String> list(JsonNode arr) {
        List<String> out = new ArrayList<>();
        if (arr.isArray()) arr.forEach(x -> out.add(x.asText()));
        return out;
    }

    public Optional<JsonNode> resolveElm(String elmRef, String elmVersion, RuleContext ctx) {
        if (elmRef == null) return Optional.empty();
        String key = elmRef + "@" + (elmVersion == null ? "" : elmVersion);
        JsonNode cached = elmCache.get(key);
        if (cached != null) return Optional.of(cached);
        Optional<JsonNode> content = vkas.resolveContent(elmRef, elmVersion, ctx);
        if (content.isEmpty()) return Optional.empty();
        JsonNode c = content.get();
        JsonNode elm;
        if (c.has("elm") && !c.path("elm").isNull()) {
            elm = c.path("elm");
        } else if (c.has("cql")) {
            CqlCompilerService.CompileOutcome out = compiler.compile(c.path("cql").asText());
            if (out instanceof CqlCompilerService.CompileSuccess s) elm = s.elmJson();
            else return Optional.empty();
        } else {
            return Optional.empty();
        }
        elmCache.put(key, elm);
        return Optional.of(elm);
    }

    public Optional<String> resolveCql(String elmRef, String elmVersion, RuleContext ctx) {
        if (elmRef == null) return Optional.empty();
        Optional<JsonNode> content = vkas.resolveContent(elmRef, elmVersion, ctx);
        if (content.isEmpty()) return Optional.empty();
        JsonNode c = content.get();
        if (!c.has("cql")) return Optional.empty();
        String cql = c.path("cql").asText();
        return (cql == null || cql.isBlank()) ? Optional.empty() : Optional.of(cql);
    }
}
