package io.simintero.x12.controller;

import io.simintero.x12.model.DeterminationResult;
import io.simintero.x12.model.DocumentReference;
import io.simintero.x12.model.IntakeCommand;
import io.simintero.x12.x275.X275Parser;
import io.simintero.x12.x278.X278Parser;
import io.simintero.x12.x278.X278Serializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST endpoints for bidirectional X12 EDI ↔ canonical model translation.
 *
 * <p>Endpoints:
 * <ul>
 *   <li>{@code POST /x12/278/parse}   — raw X12 278 text → {@link IntakeCommand} JSON</li>
 *   <li>{@code POST /x12/275/parse}   — raw X12 275 text → {@link DocumentReference} JSON</li>
 *   <li>{@code POST /x12/278/serialize} — {@link DeterminationResult} JSON → X12 278 stub text</li>
 * </ul>
 *
 * <p>PHI policy: no request bodies are logged; only segment counts or operation names.
 */
@RestController
@RequestMapping("/x12")
public class TranslatorController {

    private static final Logger log = LoggerFactory.getLogger(TranslatorController.class);

    private final X278Parser x278Parser;
    private final X278Serializer x278Serializer;
    private final X275Parser x275Parser;

    public TranslatorController(X278Parser x278Parser,
                                 X278Serializer x278Serializer,
                                 X275Parser x275Parser) {
        this.x278Parser = x278Parser;
        this.x278Serializer = x278Serializer;
        this.x275Parser = x275Parser;
    }

    /**
     * Parses a raw X12 278 interchange into a canonical IntakeCommand.
     *
     * @param rawX12 plain-text X12 278 body
     * @return IntakeCommand JSON
     */
    @PostMapping(value = "/278/parse",
            consumes = MediaType.TEXT_PLAIN_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public IntakeCommand parse278(@RequestBody String rawX12) {
        if (rawX12 == null || rawX12.isBlank()) {
            throw new IllegalArgumentException("Request body must be a non-blank X12 message");
        }
        log.info("POST /x12/278/parse — translating X12 278");
        return x278Parser.parse(rawX12);
    }

    /**
     * Parses a raw X12 275 interchange into a canonical DocumentReference.
     *
     * @param rawX12 plain-text X12 275 body
     * @return DocumentReference JSON
     */
    @PostMapping(value = "/275/parse",
            consumes = MediaType.TEXT_PLAIN_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public DocumentReference parse275(@RequestBody String rawX12) {
        if (rawX12 == null || rawX12.isBlank()) {
            throw new IllegalArgumentException("Request body must be a non-blank X12 message");
        }
        log.info("POST /x12/275/parse — translating X12 275");
        return x275Parser.parse(rawX12);
    }

    /**
     * Serializes a DeterminationResult into an X12 278 response text.
     * Phase 1 stub: always returns the placeholder interchange {@code "ISA*stub~"}.
     *
     * @param result canonical determination result JSON
     * @return X12 278 response text
     */
    @PostMapping(value = "/278/serialize",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.TEXT_PLAIN_VALUE)
    public String serialize278(@RequestBody DeterminationResult result) {
        log.info("POST /x12/278/serialize — serializing DeterminationResult");
        return x278Serializer.serialize(result);
    }
}
