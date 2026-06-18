package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.cqframework.cql.cql2elm.CqlCompilerException;
import org.cqframework.cql.cql2elm.CqlTranslator;
import org.cqframework.cql.cql2elm.LibraryManager;
import org.cqframework.cql.cql2elm.ModelManager;
import org.springframework.stereotype.Service;

import java.util.List;

/** Real CQL→ELM compiler (CQF translator). System model only — no FHIR data provider. */
@Service
public class CqlCompilerService {

    private final ObjectMapper mapper = new ObjectMapper();

    public sealed interface CompileOutcome permits CompileSuccess, CompileFailure { }
    public record CompileSuccess(JsonNode elmJson) implements CompileOutcome { }
    public record CompileFailure(List<String> errors) implements CompileOutcome { }

    public CompileOutcome compile(String cql) {
        if (cql == null || cql.isBlank()) {
            return new CompileFailure(List.of("CQL must not be blank"));
        }
        try {
            ModelManager modelManager = new ModelManager();
            LibraryManager libraryManager = new LibraryManager(modelManager);
            CqlTranslator translator = CqlTranslator.fromText(cql, libraryManager);

            List<CqlCompilerException> errors = translator.getErrors();
            if (errors != null && !errors.isEmpty()) {
                return new CompileFailure(errors.stream()
                        .map(e -> e.getMessage() == null ? e.toString() : e.getMessage())
                        .toList());
            }
            JsonNode elm = mapper.readTree(translator.toJson());
            return new CompileSuccess(elm);
        } catch (Exception e) {
            return new CompileFailure(List.of("CQL compilation error: " + e.getMessage()));
        }
    }
}
