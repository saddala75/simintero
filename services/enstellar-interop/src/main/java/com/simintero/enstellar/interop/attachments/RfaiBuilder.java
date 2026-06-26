package com.simintero.enstellar.interop.attachments;

import java.util.List;

/**
 * Builds a minimal X12 v6020 277-RFAI (request for additional information) EDI string.
 * Each LOINC code becomes one PWK (paperwork) segment identifying the document type requested.
 */
public final class RfaiBuilder {

    private RfaiBuilder() {}

    public static String build(String rfaiId, String claimId, String caseRef,
                               List<String> loincCodes) {
        // X12 control number must be exactly 9 chars (pad/truncate rfaiId)
        String ctrl = padRight(rfaiId.replaceAll("[^A-Z0-9a-z]", "").toUpperCase(), 9).substring(0, 9);
        StringBuilder sb = new StringBuilder();

        // ISA header
        sb.append("ISA*00*          *00*          *ZZ*SIMINTERO      *ZZ*CLEARINGHSE   *")
          .append("260101*1200*^*00601*").append(ctrl).append("*0*P*:\n");
        // Functional group header
        sb.append("GS*HN*SIMINTERO*CLEARINGHSE*20260101*1200*1*X*006020\n");
        // Transaction set header (277 RFAI)
        sb.append("ST*277*0001*005010X212\n");
        sb.append("BHT*0085*08*").append(ctrl).append("*20260101*1200*TH\n");

        // Payer loop (NM1*PR - payer)
        sb.append("HL*1**20*1\n");
        sb.append("NM1*PR*2*SIMINTERO HEALTH*****PI*SIM001\n");

        // Provider loop (NM1*1P - provider)
        sb.append("HL*2*1*21*1\n");
        sb.append("NM1*1P*2*PROVIDER NETWORK*****XX*1234567890\n");

        // Subscriber loop
        sb.append("HL*3*2*22*0\n");
        sb.append("TRN*1*").append(rfaiId).append("*1SIMINTERO\n");
        sb.append("NM1*IL*1************\n");
        sb.append("REF*EJ*").append(claimId).append("\n");
        sb.append("REF*D9*").append(caseRef).append("\n");

        // One PWK segment per LOINC code
        int seq = 1;
        for (String loinc : loincCodes) {
            sb.append("PWK*").append(String.format("%02d", seq)).append("*EL*").append(loinc).append("\n");
            seq++;
        }

        // Transaction set trailer
        sb.append("SE*").append(countSegments(sb.toString(), "ST")).append("*0001\n");
        // Functional group trailer
        sb.append("GE*1*1\n");
        // ISA trailer
        sb.append("IEA*1*").append(ctrl).append("\n");

        return sb.toString();
    }

    private static String padRight(String s, int len) {
        StringBuilder sb = new StringBuilder(s);
        while (sb.length() < len) sb.append('0');
        return sb.toString();
    }

    private static int countSegments(String edi, String fromTag) {
        // Count lines starting from ST* (inclusive) to SE (exclusive)
        boolean counting = false;
        int count = 0;
        for (String line : edi.split("\n")) {
            if (line.startsWith(fromTag + "*")) counting = true;
            if (counting && !line.isBlank()) count++;
        }
        return count;
    }
}
