package io.simintero.x12.x275;

import io.simintero.x12.X12ParseException;
import io.simintero.x12.model.DocumentReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;

/**
 * Lightweight segment-level parser that converts raw X12 275 text into a minimal
 * FHIR-like {@link DocumentReference}.
 *
 * <p>Parsing approach:
 * <ul>
 *   <li>Split on {@code ~} (segment terminator) to obtain segments.</li>
 *   <li>Split each segment on {@code *} (element separator) to obtain elements.</li>
 *   <li>Extract TRN02 for correlation linkage and NM1*41 NM109 for caseRef.</li>
 * </ul>
 *
 * <p>PHI policy: only segment IDs are logged, never element values.
 */
@Component
public class X275Parser {

    private static final Logger log = LoggerFactory.getLogger(X275Parser.class);

    /**
     * Parses a raw X12 275 interchange string into a {@link DocumentReference}.
     *
     * @param rawX12 the full X12 275 text (segment terminator {@code ~})
     * @return populated DocumentReference; contentType is always {@code "application/x12-275"}
     */
    public DocumentReference parse(String rawX12) {
        if (!rawX12.contains("~")) {
            throw new X12ParseException(
                    "X12 input must contain '~' segment terminator — received: " +
                    rawX12.length() + " chars with no '~'");
        }
        String rawPayloadRef = "raw:" + Base64.getEncoder()
                .encodeToString(rawX12.getBytes(StandardCharsets.UTF_8));

        String docId = UUID.randomUUID().toString();
        String caseRef = "case:unknown";
        String trnValue = null;

        String[] segments = rawX12.split("~");

        for (String rawSeg : segments) {
            String seg = rawSeg.trim();
            if (seg.isEmpty()) {
                continue;
            }

            String[] els = seg.split("\\*", -1);
            String segId = els[0];

            // Log only the segment identifier — never element values (PHI guard)
            log.debug("Processing X12 275 segment: {}", segId);

            switch (segId) {
                case "TRN" -> {
                    // TRN*1*<TRN02>*... — capture TRN02 (index 2)
                    if (els.length > 2 && !els[2].isBlank()) {
                        trnValue = els[2];
                    }
                }
                case "NM1" -> {
                    if (els.length < 2) break;
                    // NM1*41 = information receiver — use last available ID element as caseRef stub
                    if ("41".equals(els[1])) {
                        // Try NM109 at index 8; fall back to index 7; else "case:unknown"
                        String npi = extractNm109(els);
                        if (npi != null) {
                            caseRef = "case:" + npi;
                        }
                    }
                }
                default -> { /* ISA, GS, ST, BGN, SE, GE, IEA ignored */ }
            }
        }

        DocumentReference.TrnLinkage trnLinkage = new DocumentReference.TrnLinkage(
                "x12-275-trn",
                trnValue != null ? trnValue : "unknown"
        );

        return new DocumentReference(
                docId,
                caseRef,
                "application/x12-275",
                rawPayloadRef,
                trnLinkage
        );
    }

    /**
     * Extracts the NM109 identifier from an NM1 element array.
     * Tries index 8 first (standard), then index 7 (truncated segment), else null.
     */
    private String extractNm109(String[] els) {
        if (els.length > 8 && !els[8].isBlank()) {
            return els[8];
        }
        if (els.length > 7 && !els[7].isBlank()) {
            return els[7];
        }
        return null;
    }
}
