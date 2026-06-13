package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.util.*;

/**
 * Phase 1 lightweight ELM evaluator.
 *
 * Reads a simplified ELM JSON fixture (knee-arthroscopy.elm.json shipped in the
 * classpath under elm/) and interprets it against caller-provided evidence.
 *
 * Supported expression types:
 *   EvidencePresent — looks up a key in the evidence map
 *   And             — all operands true → true; any indeterminate → indeterminate; any false → false
 *
 * Outcome mapping:
 *   "Meets All Criteria" = true              → meets_all
 *   any expression       = "indeterminate"   → indeterminate
 *   "Meets All Criteria" = false             → not_met
 *
 * Determinism guarantee: pure function — same (evidence, definitions) → same result.
 */
@Component
public class ElmEvaluator {

    private static final Logger log = LoggerFactory.getLogger(ElmEvaluator.class);

    private static final String MEETS_ALL_DEF = "Meets All Criteria";
    private static final String DEFAULT_LIBRARY_REF = "knee-arthroscopy";

    // Sentinel to propagate indeterminate through And chains
    private static final Object INDETERMINATE = new Object();

    private final ObjectMapper mapper = new ObjectMapper();

    /**
     * Result of evaluating the ELM library against a set of evidence.
     *
     * @param outcome          one of: meets_all, not_met, indeterminate
     * @param requirementGaps  list of gap maps; each has requirement_id (String) and blocking (Boolean)
     * @param logicPath        ordered list of {expression_name, result} maps (for tracing)
     */
    public record ElmResult(
            String outcome,
            List<Map<String, Object>> requirementGaps,
            List<Map<String, Object>> logicPath
    ) {}

    /**
     * Evaluate the bundled knee-arthroscopy ELM fixture against {@code evidence}.
     * Delegates to {@link #evaluate(Map, String)} with the default library ref.
     */
    public ElmResult evaluate(Map<String, Object> evidence) {
        return evaluate(evidence, DEFAULT_LIBRARY_REF);
    }

    /**
     * Evaluate against an arbitrary ELM library identified by {@code libraryRef}.
     *
     * {@code libraryRef} is sanitized (colons and slashes replaced with dashes, non-alphanumeric
     * characters stripped) and used to locate {@code /elm/{sanitized-ref}.elm.json} on the
     * classpath.  If the file is not found the default knee-arthroscopy fixture is used instead
     * and a warning is logged.
     */
    public ElmResult evaluate(Map<String, Object> evidence, String libraryRef) {
        JsonNode library = loadLibrary(sanitizeRef(libraryRef));
        JsonNode defs = library.path("library").path("statements").path("def");

        if (!defs.isArray()) {
            throw new IllegalStateException("ELM fixture missing library.statements.def array");
        }

        // Build an ordered definition map preserving declaration order (required for And resolution)
        LinkedHashMap<String, JsonNode> defMap = new LinkedHashMap<>();
        for (JsonNode def : defs) {
            defMap.put(def.get("name").asText(), def);
        }

        // Evaluate every definition; cache results for And operand lookup
        Map<String, Object> evalCache = new LinkedHashMap<>();
        List<Map<String, Object>> logicPath = new ArrayList<>();

        for (Map.Entry<String, JsonNode> entry : defMap.entrySet()) {
            String name = entry.getKey();
            Object result = evalExpression(entry.getValue().get("expression"), evidence, evalCache, defMap);
            evalCache.put(name, result);
            logicPath.add(Map.of("expression_name", name, "result", resultLabel(result)));
        }

        // Determine outcome from "Meets All Criteria"
        Object meetsAll = evalCache.get(MEETS_ALL_DEF);
        boolean anyIndeterminate = evalCache.values().stream().anyMatch(v -> v == INDETERMINATE);

        String outcome;
        List<Map<String, Object>> gaps = new ArrayList<>();

        if (anyIndeterminate) {
            outcome = "indeterminate";
        } else if (Boolean.TRUE.equals(meetsAll)) {
            outcome = "meets_all";
        } else {
            outcome = "not_met";
            // Collect blocking gaps: every leaf EvidencePresent that is false
            for (Map.Entry<String, JsonNode> entry : defMap.entrySet()) {
                JsonNode expr = entry.getValue().get("expression");
                if (expr != null && "EvidencePresent".equals(expr.path("type").asText())) {
                    Object val = evalCache.get(entry.getKey());
                    if (!Boolean.TRUE.equals(val) && val != INDETERMINATE) {
                        String key = expr.path("key").asText();
                        gaps.add(Map.of("requirement_id", key, "blocking", true));
                    }
                }
            }
        }

        return new ElmResult(outcome, Collections.unmodifiableList(gaps), Collections.unmodifiableList(logicPath));
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private Object evalExpression(
            JsonNode expr,
            Map<String, Object> evidence,
            Map<String, Object> cache,
            Map<String, JsonNode> defMap) {

        if (expr == null) return false;

        String type = expr.path("type").asText();

        return switch (type) {
            case "EvidencePresent" -> {
                String key = expr.path("key").asText();
                Object val = evidence.get(key);
                if (val == null) yield false;
                if (val instanceof Boolean b) yield b;
                if ("indeterminate".equals(val)) yield INDETERMINATE;
                // Truthy strings / numbers: treat as true
                yield Boolean.parseBoolean(val.toString());
            }
            case "And" -> {
                JsonNode operands = expr.get("operands");
                boolean seenIndeterminate = false;
                if (operands != null && operands.isArray()) {
                    for (JsonNode operand : operands) {
                        String refName = operand.asText();
                        Object refResult = cache.containsKey(refName)
                                ? cache.get(refName)
                                : evalExpression(defMap.get(refName) != null
                                        ? defMap.get(refName).get("expression") : null,
                                    evidence, cache, defMap);
                        if (refResult == INDETERMINATE) {
                            seenIndeterminate = true;
                        } else if (!Boolean.TRUE.equals(refResult)) {
                            yield false; // short-circuit: definitive false
                        }
                    }
                }
                yield seenIndeterminate ? INDETERMINATE : true;
            }
            default -> false;
        };
    }

    private String resultLabel(Object result) {
        if (result == INDETERMINATE) return "indeterminate";
        if (Boolean.TRUE.equals(result)) return "true";
        return "false";
    }

    /**
     * Sanitize a library ref so it can be used as a filesystem-safe classpath segment.
     * e.g. {@code urn:sim:policy:knee-arthroscopy:1.0.0} → {@code urn-sim-policy-knee-arthroscopy-1.0.0}
     */
    private String sanitizeRef(String ref) {
        return ref.replaceAll("[:/]", "-")
                  .replaceAll("[^a-zA-Z0-9._-]", "")
                  .toLowerCase();
    }

    /**
     * Load an ELM library by sanitized ref.  Falls back to the default knee-arthroscopy
     * fixture if the named resource is not found on the classpath.
     */
    private JsonNode loadLibrary(String sanitizedRef) {
        String path = "/elm/" + sanitizedRef + ".elm.json";
        try (InputStream is = getClass().getResourceAsStream(path)) {
            if (is != null) {
                return mapper.readTree(is);
            }
        } catch (Exception ignored) {
            // fall through to default
        }
        if (!DEFAULT_LIBRARY_REF.equals(sanitizedRef)) {
            log.warn("ELM fixture not found for ref '{}' at '{}'; falling back to default library", sanitizedRef, path);
        }
        return loadDefaultLibrary();
    }

    private JsonNode loadDefaultLibrary() {
        try (InputStream is = getClass().getResourceAsStream("/elm/" + DEFAULT_LIBRARY_REF + ".elm.json")) {
            if (is == null) {
                throw new IllegalStateException("Default ELM fixture not found on classpath: /elm/" + DEFAULT_LIBRARY_REF + ".elm.json");
            }
            return mapper.readTree(is);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to load default ELM fixture", e);
        }
    }
}
