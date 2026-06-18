package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RuleResolver {
    static final String COVERAGE_RULE_BASE = "https://artifacts.simintero.io/shared/coverage_rule/";

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
        return vkas.resolveContent(COVERAGE_RULE_BASE + procedureCode, null, ctx).map(this::parse);
    }

    @SuppressWarnings("unchecked")
    private CoverageRule parse(JsonNode c) {
        List<Map<String, Object>> reqs = new ArrayList<>();
        c.path("evidence_requirements").forEach(r -> reqs.add(mapper.convertValue(r, Map.class)));
        JsonNode dtr = c.path("dtr_package_ref");
        return new CoverageRule(
            list(c.path("procedure_codes")),
            c.path("pa_required").asBoolean(false),
            list(c.path("pins")),
            (dtr.isMissingNode() || dtr.isNull()) ? null : dtr.asText(),
            reqs,
            c.path("elm_ref").isMissingNode() ? null : c.path("elm_ref").asText(),
            c.path("elm_version").isMissingNode() ? null : c.path("elm_version").asText());
    }

    private static List<String> list(JsonNode arr) {
        List<String> out = new ArrayList<>();
        if (arr.isArray()) arr.forEach(x -> out.add(x.asText()));
        return out;
    }

    /** Resolve a cql_library artifact's ELM: content.elm if present, else compile content.cql. Cached by (elmRef, version). */
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
}
