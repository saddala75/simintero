package com.simintero.enstellar.interop.attachments;

import java.util.Arrays;
import java.util.List;

/**
 * Parses an X12 v6020 275 (additional information) EDI string.
 * Extracts the control number (TRN*1), claim ID (REF*EJ), tenant (REF*SIM),
 * LOINC code (PWK), and C-CDA payload (BIN).
 */
public final class X12v6020AttachmentParser {

    private X12v6020AttachmentParser() {}

    public static ParsedAttachment275 parse(String edi) {
        if (edi == null || !edi.contains("ST*275")) {
            throw new AttachmentParseException("Not a valid X12 275 transaction");
        }

        List<String[]> segments = Arrays.stream(edi.split("[\\r\\n]+"))
            .map(String::trim)
            .filter(l -> !l.isBlank())
            .map(l -> l.split("\\*"))
            .toList();

        String controlNumber = null;
        String claimId = null;
        String tenantId = null;
        String loincCode = null;
        String ccdaBase64 = null;

        for (String[] seg : segments) {
            String tag = seg[0];
            switch (tag) {
                case "TRN" -> {
                    if (seg.length > 2) controlNumber = seg[2].trim();
                }
                case "REF" -> {
                    if (seg.length > 2) {
                        if ("EJ".equals(seg[1].trim())) claimId = seg[2].trim();
                        if ("SIM".equals(seg[1].trim())) tenantId = seg[2].trim();
                    }
                }
                case "PWK" -> {
                    if (seg.length > 3) loincCode = seg[3].trim();
                }
                case "BIN" -> {
                    // BIN*<length>*<base64data>
                    if (seg.length > 2) ccdaBase64 = seg[2].trim();
                }
                default -> {} // ignore other segments
            }
        }

        if (controlNumber == null || claimId == null || ccdaBase64 == null) {
            throw new AttachmentParseException(
                "Missing required segments: controlNumber=" + controlNumber
                + " claimId=" + claimId + " ccdaBase64=" + (ccdaBase64 != null ? "present" : "null"));
        }

        return new ParsedAttachment275(controlNumber, claimId,
                tenantId != null ? tenantId : "unknown", ccdaBase64, loincCode);
    }
}
