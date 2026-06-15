package com.simintero.enstellar.x12.mapper;

import com.simintero.enstellar.canonical.Case;
import com.simintero.enstellar.canonical.Coverage;
import com.simintero.enstellar.canonical.Member;
import com.simintero.enstellar.canonical.Provider;
import com.simintero.enstellar.canonical.ServiceLine;
import com.simintero.enstellar.x12.config.TradingPartnerProfile;
import com.simintero.enstellar.x12.parser.X12Segment;
import com.simintero.enstellar.x12.parser.X12Transaction;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Maps a parsed X12 278 transaction to the canonical {@link Case} model.
 *
 * Loop mapping:
 *   2000A (HL level 20) = payer / utilization management organization
 *   2000B (HL level 21) = requesting provider
 *   2000C (HL level 22) = subscriber / member
 *   2000E (HL level EV) = event / service (one per service line)
 */
@Component
public class X12ToCanonicalMapper {

    public Case map(X12Transaction tx, String tenantId, TradingPartnerProfile profile) {
        // BHT03 = reference / correlation ID
        String correlationId = tx.findSegment("BHT")
                .map(s -> s.getElement(3))
                .filter(v -> !v.isBlank())
                .orElse(UUID.randomUUID().toString());

        // UM03 = certification type / urgency code
        String urgencyCode = tx.findSegment("UM")
                .map(s -> s.getElement(3))
                .orElse("");
        String urgency = profile.urgencyCodeMap().getOrDefault(urgencyCode, "standard");

        UUID memberId = UUID.randomUUID();
        Member member = buildMember(tx, tenantId, memberId);
        Provider requestingProvider = buildRequestingProvider(tx, tenantId);
        Coverage coverage = buildCoverage(tx, tenantId, memberId);
        List<ServiceLine> serviceLines = buildServiceLines(tx, tenantId);

        Instant now = Instant.now();
        return new Case(
                UUID.randomUUID(),          // caseId
                tenantId,
                correlationId,
                profile.defaultLob(),
                null,                       // program
                "intake",
                urgency,
                member,
                coverage,
                requestingProvider,
                null,                       // servicingProvider
                serviceLines,
                null,                       // decisions
                now,
                now
        );
    }

    // -------------------------------------------------------------------------
    // Private builders
    // -------------------------------------------------------------------------

    private Member buildMember(X12Transaction tx, String tenantId, UUID memberId) {
        return tx.findSegmentInLoop("2000C", "NM1")
                .map(nm1 -> new Member(
                        memberId,
                        tenantId,
                        null,                   // mrn
                        nm1.getElement(4),      // NM104 = first name
                        nm1.getElement(3),      // NM103 = last name
                        null,                   // dateOfBirth (from DMG — not mapped here)
                        null,                   // gender
                        null                    // identifiers
                ))
                .orElseThrow(() -> new IllegalArgumentException(
                        "X12 278 missing required 2000C NM1*IL segment (subscriber/member)"));
    }

    private Provider buildRequestingProvider(X12Transaction tx, String tenantId) {
        return tx.findSegmentInLoop("2000B", "NM1")
                .map(nm1 -> new Provider(
                        UUID.randomUUID(),
                        tenantId,
                        nm1.getElement(9),                              // NM109 = NPI
                        (nm1.getElement(3) + " " + nm1.getElement(4)).strip(), // last + first
                        null,                                           // specialty
                        null,                                           // organizationName
                        null                                            // identifiers
                ))
                .orElseThrow(() -> new IllegalArgumentException(
                        "X12 278 missing required 2000B NM1*1P segment (requesting provider)"));
    }

    private Coverage buildCoverage(X12Transaction tx, String tenantId, UUID memberId) {
        return tx.findSegmentInLoop("2000A", "NM1")
                .map(nm1 -> new Coverage(
                        UUID.randomUUID(),
                        tenantId,
                        memberId,
                        null,               // planId
                        null,               // groupId
                        null,               // subscriberId
                        nm1.getElement(3),  // NM103 = payer name
                        null,               // lob
                        null,               // effectiveDate
                        null                // terminationDate
                ))
                .orElse(new Coverage(
                        UUID.randomUUID(), tenantId, memberId,
                        null, null, null, null, null, null, null));
    }

    private List<ServiceLine> buildServiceLines(X12Transaction tx, String tenantId) {
        List<X12Segment> sv1Segments = tx.findAllSegmentsInLoop("2000E", "SV1");
        List<X12Segment> hiSegments  = tx.findAllSegmentsInLoop("2000E", "HI");

        // Collect all diagnosis codes from HI segments (BK or ABK qualifier; strip qualifier prefix)
        List<String> diagCodes = hiSegments.stream()
                .map(hi -> {
                    String raw = hi.getElement(1);
                    int colon = raw.indexOf(':');
                    return colon >= 0 ? raw.substring(colon + 1) : raw;
                })
                .filter(c -> !c.isBlank())
                .toList();

        List<ServiceLine> lines = new ArrayList<>();
        for (int i = 0; i < sv1Segments.size(); i++) {
            X12Segment sv1 = sv1Segments.get(i);

            // SV101 = composite procedure code, e.g. "HC:99213"
            String procRaw = sv1.getElement(1);
            int colon = procRaw.indexOf(':');
            String procCode = colon >= 0 ? procRaw.substring(colon + 1) : procRaw;

            // SV102 = monetary amount; SV103 = unit or basis for measurement code
            double qty = 1.0;
            try {
                qty = Double.parseDouble(sv1.getElement(2));
            } catch (NumberFormatException ignored) {
                // leave default
            }
            String units = sv1.getElement(3);

            lines.add(new ServiceLine(
                    UUID.randomUUID(),
                    tenantId,
                    i + 1,              // sequence (1-based)
                    null,               // serviceTypeCode
                    procCode,
                    null,               // procedureDescription
                    qty,
                    units,
                    diagCodes,
                    null,               // placeOfService
                    null,               // requestedStartDate
                    null                // requestedEndDate
            ));
        }
        return lines;
    }
}
