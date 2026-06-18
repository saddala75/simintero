package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.util.*;

/**
 * Phase 1 ELM evaluator.
 *
 * <p>Loads a compiled ELM library (real cql-to-elm output) from the classpath under
 * {@code /elm/} and drives evaluation through the {@link ElmInterpreter}, which applies
 * Kleene three-valued logic (TRUE / FALSE / null=indeterminate) over the bounded ELM
 * subset emitted by parameter-based boolean/comparison CQL.
 *
 * <p>Each {@code ExpressionDef} under {@code library.statements.def} is evaluated in
 * declaration order. The outcome is derived from the {@code "Meets All Criteria"} define:
 * <ul>
 *   <li>null            → indeterminate</li>
 *   <li>{@code TRUE}    → meets_all</li>
 *   <li>{@code FALSE}   → not_met (with blocking gaps for each false leaf ParameterRef)</li>
 * </ul>
 *
 * <p>Determinism guarantee: pure function — same (evidence, library) → same result, with
 * declaration-order iteration ({@link LinkedHashMap}) for a stable logicPath.
 */
@Component
public class ElmEvaluator {

    private static final Logger log = LoggerFactory.getLogger(ElmEvaluator.class);

    private static final String MEETS_ALL_DEF = "Meets All Criteria";
    private static final String DEFAULT_LIBRARY_REF = "knee-arthroscopy";

    private final ObjectMapper mapper = new ObjectMapper();
    private final ElmInterpreter interpreter;

    public ElmEvaluator(ElmInterpreter interpreter) {
        this.interpreter = interpreter;
    }

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
            throw new IllegalStateException("ELM missing library.statements.def");
        }

        // Build an ordered definition map preserving declaration order (required for
        // ExpressionRef resolution and a deterministic logicPath).
        LinkedHashMap<String, JsonNode> defsByName = new LinkedHashMap<>();
        for (JsonNode d : defs) {
            defsByName.put(d.path("name").asText(), d);
        }

        Map<String, Object> results = new LinkedHashMap<>();
        List<Map<String, Object>> logicPath = new ArrayList<>();
        for (Map.Entry<String, JsonNode> e : defsByName.entrySet()) {
            Object r = interpreter.eval(e.getValue().path("expression"), evidence, defsByName);
            results.put(e.getKey(), r);
            logicPath.add(Map.of("expression_name", e.getKey(), "result", label(r)));
        }

        Object meetsAll = results.get(MEETS_ALL_DEF);
        String outcome;
        List<Map<String, Object>> gaps = new ArrayList<>();
        if (meetsAll == null) {
            outcome = "indeterminate";
        } else if (Boolean.TRUE.equals(meetsAll)) {
            outcome = "meets_all";
        } else {
            outcome = "not_met";
            // Blocking gaps: every leaf ParameterRef define that resolved to false.
            // requirement_id is the parameter/evidence key (ParameterRef.name).
            for (Map.Entry<String, JsonNode> e : defsByName.entrySet()) {
                JsonNode expr = e.getValue().path("expression");
                if ("ParameterRef".equals(expr.path("type").asText())
                        && Boolean.FALSE.equals(results.get(e.getKey()))) {
                    gaps.add(Map.of("requirement_id", expr.path("name").asText(), "blocking", true));
                }
            }
        }

        return new ElmResult(outcome, Collections.unmodifiableList(gaps), Collections.unmodifiableList(logicPath));
    }

    private String label(Object r) {
        return r == null ? "indeterminate" : (Boolean.TRUE.equals(r) ? "true" : "false");
    }

    // -------------------------------------------------------------------------
    // Classpath loading helpers — KEPT VERBATIM from the prior implementation.
    // -------------------------------------------------------------------------

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
