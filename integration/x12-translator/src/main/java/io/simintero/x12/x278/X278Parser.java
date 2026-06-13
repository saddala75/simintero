package io.simintero.x12.x278;

import io.simintero.x12.X12ParseException;
import io.simintero.x12.model.IntakeCommand;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * Lightweight segment-level parser that converts raw X12 278 text into a canonical
 * {@link IntakeCommand}.
 *
 * <p>Parsing approach:
 * <ul>
 *   <li>Split on {@code ~} (segment terminator) to obtain segments.</li>
 *   <li>Split each segment on {@code *} (element separator) to obtain elements.</li>
 *   <li>Extract key fields by segment ID (BHT, NM1, REF, SV1).</li>
 * </ul>
 *
 * <p>PHI policy: only segment IDs are logged, never element values.
 */
@Component
public class X278Parser {

    private static final Logger log = LoggerFactory.getLogger(X278Parser.class);

    /**
     * Parses a raw X12 278 interchange string into a canonical {@link IntakeCommand}.
     *
     * @param rawX12 the full X12 278 text (segment terminator {@code ~})
     * @return populated IntakeCommand; channel is always {@code "X12_278"}
     */
    public IntakeCommand parse(String rawX12) {
        if (!rawX12.contains("~")) {
            throw new X12ParseException(
                    "X12 input must contain '~' segment terminator — received: " +
                    rawX12.length() + " chars with no '~'");
        }
        // Build rawPayloadRef before any processing — no PHI in the ref itself
        String rawPayloadRef = "raw:" + Base64.getEncoder()
                .encodeToString(rawX12.getBytes(StandardCharsets.UTF_8));

        String channel = "X12_278";
        String caseRef = null;
        String receivedAt = Instant.now().toString();
        String memberRef = "member:unknown";
        String coverageRef = null;
        String requestingNpi = null;
        String servicingNpi = null;
        List<IntakeCommand.ServiceLine> serviceLines = new ArrayList<>();
        List<IntakeCommand.ExternalId> externalIds = new ArrayList<>();
        String urgency = "standard";

        String[] segments = rawX12.split("~");

        for (String rawSeg : segments) {
            String seg = rawSeg.trim();
            if (seg.isEmpty()) {
                continue;
            }

            // Split preserving trailing empty elements
            String[] els = seg.split("\\*", -1);
            String segId = els[0];

            // Log only the segment identifier — never element values (PHI guard)
            log.debug("Processing X12 segment: {}", segId);

            switch (segId) {
                case "BHT" -> {
                    // BHT03 = transaction reference number → external ID
                    if (els.length > 3 && !els[3].isBlank()) {
                        externalIds.add(new IntakeCommand.ExternalId("x12-278-bht03", els[3]));
                    }
                    // BHT06 = transaction type → urgency
                    if (els.length > 6 && !els[6].isBlank()) {
                        urgency = "13".equals(els[6]) ? "expedited" : "standard";
                    }
                }
                case "NM1" -> {
                    if (els.length < 2) break;
                    String entityCode = els[1];

                    switch (entityCode) {
                        case "IL" -> {
                            // Insured / member
                            // NM109 = index 8 (id code)
                            if (els.length > 8) {
                                String nm109 = els[8];
                                if (!nm109.isBlank()) {
                                    memberRef = "member:" + nm109;
                                }
                            }
                        }
                        case "82" -> {
                            // Rendering / requesting provider NPI
                            if (els.length > 8 && !els[8].isBlank()) {
                                requestingNpi = els[8];
                            }
                        }
                        case "77" -> {
                            // Service facility / servicing provider NPI
                            if (els.length > 8 && !els[8].isBlank()) {
                                servicingNpi = els[8];
                            }
                        }
                        default -> { /* other NM1 entity codes ignored */ }
                    }
                }
                case "REF" -> {
                    // REF*EA → coverage reference
                    if (els.length > 2 && "EA".equals(els[1]) && !els[2].isBlank()) {
                        coverageRef = "coverage:" + els[2];
                    }
                }
                case "SV1" -> {
                    // SV1*HC:XXXXX → service line code
                    if (els.length > 1 && els[1].contains(":")) {
                        String[] compositeParts = els[1].split(":", -1);
                        if (compositeParts.length > 1 && !compositeParts[1].isBlank()) {
                            serviceLines.add(new IntakeCommand.ServiceLine(
                                    compositeParts[1], compositeParts[0], null));
                        }
                    }
                }
                default -> { /* ISA, GS, ST, SE, GE, IEA and others are ignored */ }
            }
        }

        IntakeCommand.Providers providers = new IntakeCommand.Providers(requestingNpi, servicingNpi);

        return new IntakeCommand(
                channel,
                caseRef,
                rawPayloadRef,
                receivedAt,
                memberRef,
                coverageRef,
                providers,
                serviceLines,
                urgency,
                externalIds
        );
    }
}
