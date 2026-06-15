package com.simintero.enstellar.x12.mapper;

import com.simintero.enstellar.canonical.Case;
import com.simintero.enstellar.canonical.ServiceLine;
import com.simintero.enstellar.x12.config.TradingPartnerProfile;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Maps a canonical {@link Case} back to a valid X12 278 request interchange.
 *
 * The generated X12 is structurally parseable by {@link com.simintero.enstellar.x12.parser.X12Parser}
 * and preserves the fields required for the round-trip regression:
 *   - requesting provider NPI (NM1*1P element 9)
 *   - service line procedure code (SV1 element 1, HC: qualifier)
 *   - urgency (UM element 3, reversed via urgencyCodeMap)
 */
@Component
public class CanonicalToX12Mapper {

    public String map(Case c, TradingPartnerProfile profile) {
        // Reverse lookup: urgency name → urgency code
        String urgencyCode = profile.urgencyCodeMap().entrySet().stream()
            .filter(e -> e.getValue().equalsIgnoreCase(c.urgency()))
            .map(Map.Entry::getKey)
            .findFirst()
            .orElse("1");

        String corrId = c.correlationId() != null ? c.correlationId() : c.caseId().toString();
        String payerName = (c.coverage() != null && c.coverage().payerName() != null)
            ? c.coverage().payerName() : "UNKNOWN";
        String payerId = (c.coverage() != null && c.coverage().subscriberId() != null)
            ? c.coverage().subscriberId() : "UNKNOWN";
        String provLast = (c.requestingProvider() != null && c.requestingProvider().name() != null)
            ? c.requestingProvider().name().split(" ")[0] : "UNKNOWN";
        String provFirst = (c.requestingProvider() != null && c.requestingProvider().name() != null
                && c.requestingProvider().name().contains(" "))
            ? c.requestingProvider().name().substring(c.requestingProvider().name().indexOf(' ') + 1) : "";
        String npi = c.requestingProvider() != null ? c.requestingProvider().npi() : "0000000000";
        String memLast = (c.member() != null && c.member().lastName() != null) ? c.member().lastName() : "UNKNOWN";
        String memFirst = (c.member() != null && c.member().firstName() != null) ? c.member().firstName() : "";

        // Build the transaction segments (ST through just before SE)
        StringBuilder txBody = new StringBuilder();
        int segmentCount = 0;
        txBody.append("ST*278*0001~\n"); segmentCount++;
        txBody.append("BHT*0007*13*").append(corrId).append("*20240101*1200*RQ~\n"); segmentCount++;
        // Loop 2000A — payer
        txBody.append("HL*1**20*1~\n"); segmentCount++;
        txBody.append("NM1*X3*2*").append(payerName).append("*****PI*").append(payerId).append("~\n"); segmentCount++;
        // Loop 2000B — requesting provider
        txBody.append("HL*2*1*21*1~\n"); segmentCount++;
        txBody.append("NM1*1P*1*").append(provLast).append("*").append(provFirst)
              .append("****XX*").append(npi).append("~\n"); segmentCount++;
        // Loop 2000C — member
        txBody.append("HL*3*2*22*1~\n"); segmentCount++;
        txBody.append("NM1*IL*1*").append(memLast).append("*").append(memFirst)
              .append("****MI*UNKNOWN~\n"); segmentCount++;
        // Loop 2000E — one HL/UM/HI/SV1 block per service line
        if (c.serviceLines() != null) {
            for (ServiceLine sl : c.serviceLines()) {
                txBody.append("HL*4*3*EV*0~\n"); segmentCount++;
                txBody.append("UM*HS*I*").append(urgencyCode).append("~\n"); segmentCount++;
                if (sl.diagnosisCodes() != null) {
                    for (String diag : sl.diagnosisCodes()) {
                        txBody.append("HI*BK:").append(diag).append("~\n"); segmentCount++;
                    }
                }
                String qty = sl.quantity() != null ? String.valueOf(sl.quantity().intValue()) : "1";
                String units = sl.units() != null ? sl.units() : "UN";
                txBody.append("SV1*HC:").append(sl.procedureCode())
                      .append("*").append(qty).append("*").append(units).append("*1***1~\n"); segmentCount++;
            }
        }
        segmentCount++; // SE itself counts

        StringBuilder sb = new StringBuilder();
        sb.append("ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *240101*1200*^*00501*000000001*0*P*:~\n");
        sb.append("GS*HS*SENDER*RECEIVER*20240101*1200*1*X*005010X217~\n");
        sb.append(txBody);
        sb.append("SE*").append(segmentCount).append("*0001~\n");
        sb.append("GE*1*1~\n");
        sb.append("IEA*1*000000001~\n");
        return sb.toString();
    }
}
