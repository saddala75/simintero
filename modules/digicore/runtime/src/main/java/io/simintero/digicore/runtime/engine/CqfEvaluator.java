package io.simintero.digicore.runtime.engine;

import ca.uhn.fhir.context.FhirContext;
import org.cqframework.cql.cql2elm.CqlCompilerOptions;
import org.cqframework.cql.cql2elm.LibraryManager;
import org.cqframework.cql.cql2elm.LibrarySourceProvider;
import org.cqframework.cql.cql2elm.ModelManager;
import org.hl7.elm.r1.VersionedIdentifier;
import org.opencds.cqf.cql.engine.data.CompositeDataProvider;
import org.opencds.cqf.cql.engine.data.DataProvider;
import org.opencds.cqf.cql.engine.execution.CqlEngine;
import org.opencds.cqf.cql.engine.execution.Environment;
import org.opencds.cqf.cql.engine.execution.EvaluationResult;
import org.opencds.cqf.cql.engine.execution.ExpressionResult;
import org.opencds.cqf.cql.engine.fhir.model.R4FhirModelResolver;
import org.opencds.cqf.cql.engine.retrieve.RetrieveProvider;
import org.opencds.cqf.cql.engine.terminology.TerminologyProvider;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * CQF-reference-engine evaluator (slice 1.1). Evaluates real CQL against FHIR R4 data,
 * replacing the hand-rolled {@link ElmInterpreter} on the evaluate path.
 *
 * <p>The engine compiles CQL TEXT on demand via a registered {@link LibrarySourceProvider}
 * (no hand-injected ELM JSON). Per request it builds a fresh {@link Environment} wired with:
 * <ul>
 *   <li>an {@link R4FhirModelResolver} + the request's {@link RetrieveProvider}
 *       (either the test override or a {@link FabricRetrieveProvider} reading
 *       {@code fabric.resource} under the tenant GUC) under {@code http://hl7.org/fhir};</li>
 *   <li>a {@link VkasTerminologyProvider} that resolves value sets from VKAS and performs
 *       membership; an unresolvable value set / unhonorable code filter throws and the abstain
 *       backstop turns it into {@code indeterminate}.</li>
 * </ul>
 *
 * <p><b>Safety invariant (the whole point):</b> the entire evaluation is wrapped in a
 * try/catch. ANY failure — compile, library, retrieve, terminology, or engine error — OR a
 * missing {@code "Meets All Criteria"} expression yields
 * {@code ElmResult("indeterminate", [], [])}. The evaluator NEVER returns {@code meets_all} on
 * error and NEVER reports {@code not_met} by omission. A retrieve that succeeds but returns no
 * resources legitimately yields {@code not_met} (exists=false); that is not an error.
 */
@Component
public class CqfEvaluator {

    private static final String MEETS_ALL_DEF = "Meets All Criteria";

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(CqfEvaluator.class);

    private final JdbcOperations jdbc;
    private final FhirContext fhir;
    private final VkasClient vkas;

    /** Matches a CQL library header: {@code library <id> version '<ver>'} (id optionally quoted). */
    private static final java.util.regex.Pattern LIBRARY_HEADER =
            java.util.regex.Pattern.compile("library\\s+\"?([A-Za-z0-9_]+)\"?\\s+version\\s+'([^']+)'");

    public CqfEvaluator(JdbcOperations jdbc, FhirContext fhir, VkasClient vkas) {
        this.jdbc = jdbc;
        this.fhir = fhir;
        this.vkas = vkas;
    }

    /**
     * Convenience overload: parse the {@code library <id> version '<ver>'} header out of
     * {@code cqlText} and delegate to the 7-arg {@link #evaluate}. If the header cannot be parsed,
     * abstain ({@code indeterminate}) — NEVER {@code meets_all} — exactly like the 7-arg method's
     * failure path. Lets the evaluate HTTP path pass only the raw CQL text.
     */
    public ElmEvaluator.ElmResult evaluate(
            String cqlText, Map<String, Object> evidence,
            String tenantId, String memberRef, RetrieveProvider retrieveOverride) {
        if (cqlText == null) {
            return indeterminate();
        }
        java.util.regex.Matcher m = LIBRARY_HEADER.matcher(cqlText);
        if (!m.find()) {
            log.warn("CQF evaluation abstained: no 'library X version Y' header in CQL");
            return indeterminate();
        }
        return evaluate(cqlText, m.group(1), m.group(2), evidence, tenantId, memberRef, retrieveOverride);
    }

    /**
     * Evaluate {@code cqlText} (library {@code libraryId} version {@code libraryVersion}) against
     * the member's FHIR data, threading boolean {@code evidence} entries as engine parameters.
     *
     * @param retrieveOverride if non-null, used as the FHIR {@link RetrieveProvider} (tests pass a
     *                         fake); if null, a {@link FabricRetrieveProvider} scoped to
     *                         {@code tenantId}/{@code memberRef} is constructed.
     */
    public ElmEvaluator.ElmResult evaluate(
            String cqlText, String libraryId, String libraryVersion,
            Map<String, Object> evidence, String tenantId, String memberRef,
            RetrieveProvider retrieveOverride) {
        try {
            ModelManager modelManager = new ModelManager();
            LibraryManager libraryManager =
                    new LibraryManager(modelManager, CqlCompilerOptions.defaultOptions());
            libraryManager.getLibrarySourceLoader().registerProvider(new LibrarySourceProvider() {
                @Override
                public InputStream getLibrarySource(VersionedIdentifier id) {
                    return libraryId.equals(id.getId())
                            ? new ByteArrayInputStream(cqlText.getBytes(StandardCharsets.UTF_8))
                            : null;
                }
            });

            TerminologyProvider terminologyProvider = new VkasTerminologyProvider(vkas);
            RetrieveProvider baseRetrieve = retrieveOverride != null
                    ? retrieveOverride
                    : new FabricRetrieveProvider(jdbc, fhir, tenantId, memberRef, terminologyProvider);

            DataProvider dataProvider =
                    new CompositeDataProvider(new R4FhirModelResolver(), baseRetrieve);
            Environment environment = new Environment(
                    libraryManager,
                    Map.of("http://hl7.org/fhir", dataProvider),
                    terminologyProvider);
            CqlEngine engine = new CqlEngine(environment);

            // Patient context value = memberRef (opaque to FabricRetrieveProvider, which scopes by
            // member_ref). evidence entries are passed as CQL parameters so boolean rules evaluate.
            Map<String, Object> parameters = (evidence == null || evidence.isEmpty())
                    ? null : new LinkedHashMap<>(evidence);
            VersionedIdentifier identifier =
                    new VersionedIdentifier().withId(libraryId).withVersion(libraryVersion);
            java.util.Set<String> allExpressions = null; // null = evaluate every define
            org.apache.commons.lang3.tuple.Pair<String, Object> patientContext =
                    org.apache.commons.lang3.tuple.Pair.of("Patient", memberRef);
            // 5-arg overload: (VersionedIdentifier, Set<expressions>, Pair<contextName,value>,
            // Map<parameters>, DebugMap) — the form that accepts BOTH a Patient context and a
            // parameters map for VersionedIdentifier-loaded libraries.
            EvaluationResult result = engine.evaluate(
                    identifier, allExpressions, patientContext, parameters,
                    /* debugMap */ (org.opencds.cqf.cql.engine.debug.DebugMap) null);

            Map<String, ExpressionResult> expressionResults = result.expressionResults;
            if (!expressionResults.containsKey(MEETS_ALL_DEF)) {
                // No decision expression -> abstain rather than guess.
                log.warn("CQF evaluation abstained (indeterminate) for library '{}': "
                        + "no '{}' define found", libraryId, MEETS_ALL_DEF);
                return indeterminate();
            }

            Object meets = expressionResults.get(MEETS_ALL_DEF).value();
            String outcome;
            if (Boolean.TRUE.equals(meets)) {
                outcome = "meets_all";
            } else if (Boolean.FALSE.equals(meets)) {
                outcome = "not_met";
            } else {
                // Non-Boolean / null decision value -> abstain rather than guess.
                log.warn("CQF evaluation abstained (indeterminate) for library '{}': "
                        + "'{}' value is non-Boolean/null ({})", libraryId, MEETS_ALL_DEF, meets);
                return indeterminate();
            }

            List<Map<String, Object>> requirementGaps = new ArrayList<>();
            List<Map<String, Object>> logicPath = new ArrayList<>();
            for (Map.Entry<String, ExpressionResult> e : expressionResults.entrySet()) {
                String name = e.getKey();
                Object value = e.getValue().value();
                logicPath.add(Map.of("step", name, "result", String.valueOf(value)));
                if (!MEETS_ALL_DEF.equals(name) && Boolean.FALSE.equals(value)) {
                    requirementGaps.add(Map.of("requirement_id", name));
                }
            }

            return new ElmEvaluator.ElmResult(outcome, List.copyOf(requirementGaps), List.copyOf(logicPath));
        } catch (Exception e) {
            // Abstain on ANY failure — never approve, never not_met-by-omission.
            log.warn("CQF evaluation abstained (indeterminate) for library '{}' tenant '{}' member '{}': {}",
                    libraryId, tenantId, memberRef, e.toString(), e);
            return indeterminate();
        }
    }

    private static ElmEvaluator.ElmResult indeterminate() {
        return new ElmEvaluator.ElmResult("indeterminate", List.of(), List.of());
    }
}
