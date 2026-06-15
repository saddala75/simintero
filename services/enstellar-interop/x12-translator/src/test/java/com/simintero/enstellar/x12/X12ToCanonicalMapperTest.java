package com.simintero.enstellar.x12;

import com.simintero.enstellar.canonical.Case;
import com.simintero.enstellar.x12.config.TradingPartnerProfile;
import com.simintero.enstellar.x12.mapper.X12ToCanonicalMapper;
import com.simintero.enstellar.x12.parser.X12Parser;
import com.simintero.enstellar.x12.parser.X12Transaction;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for X12ToCanonicalMapper — no Spring context needed.
 *
 * Fixture: minimal X12 278 with loops 2000A (payer), 2000B (requesting provider),
 * 2000C (member), and 2000E (event/service line).
 */
class X12ToCanonicalMapperTest {

    /**
     * Minimal but structurally correct X12 278 278-request fixture.
     *
     * Segment breakdown:
     *   ISA  — interchange control header (element separator='*', terminator='~')
     *   GS   — functional group header
     *   ST   — transaction set header
     *   BHT  — beginning of hierarchical transaction; BHT03=CORR-001 (correlation ID)
     *   HL*1**20  — 2000A loop (payer)
     *   NM1*X3 — payer name = "PAYER"
     *   HL*2*1*21 — 2000B loop (requesting provider)
     *   NM1*1P — requesting provider; NM103=DOE NM104=JANE NM109=1234567890 (NPI)
     *   HL*3*2*22 — 2000C loop (subscriber/member)
     *   NM1*IL — subscriber; NM103=SMITH NM104=JOHN NM108=MI NM109=MBR001
     *   DMG   — demographic info (not mapped in this version)
     *   HL*4*3*EV — 2000E loop (event/service)
     *   UM*HS*I*2 — utilization management; UM03=2 (urgency code)
     *   HI*BK:M5410 — diagnosis ICD-10
     *   SV1*HC:99213*100*UN*1 — service line; procedure=99213, qty=100, units=UN
     */
    static final String MINIMAL_278 =
            "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *240101*1200*^*00501*000000001*0*P*:~" +
            "GS*HS*SENDER*RECEIVER*20240101*1200*1*X*005010X217~" +
            "ST*278*0001~" +
            "BHT*0007*13*CORR-001*20240101*1200*RQ~" +
            "HL*1**20*1~" +
            "NM1*X3*2*PAYER*****PI*PAYER001~" +
            "HL*2*1*21*1~" +
            "NM1*1P*1*DOE*JANE****XX*1234567890~" +
            "HL*3*2*22*1~" +
            "NM1*IL*1*SMITH*JOHN****MI*MBR001~" +
            "DMG*D8*19800101*M~" +
            "HL*4*3*EV*0~" +
            "UM*HS*I*2~" +
            "HI*BK:M5410~" +
            "SV1*HC:99213*100*UN*1***1~" +
            "SE*17*0001~" +
            "GE*1*1~" +
            "IEA*1*000000001~";

    X12ToCanonicalMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new X12ToCanonicalMapper();
    }

    @Test
    void map_minimalFixture_extractsRequiredFields() {
        X12Transaction tx = new X12Parser().parse(MINIMAL_278);
        TradingPartnerProfile profile = new TradingPartnerProfile(
                "commercial",
                Map.of("1", "standard", "2", "expedited", "3", "concurrent")
        );

        Case result = mapper.map(tx, "test-tenant", profile);

        assertThat(result.tenantId()).isEqualTo("test-tenant");
        assertThat(result.correlationId()).isEqualTo("CORR-001");
        assertThat(result.urgency()).isEqualToIgnoringCase("expedited");     // UM03=2 → expedited
        assertThat(result.member()).isNotNull();
        assertThat(result.member().memberId()).isNotNull();                   // UUID generated
        assertThat(result.member().lastName()).isEqualTo("SMITH");
        assertThat(result.member().firstName()).isEqualTo("JOHN");
        assertThat(result.requestingProvider().npi()).isEqualTo("1234567890");
        assertThat(result.serviceLines()).hasSize(1);
        assertThat(result.serviceLines().get(0).procedureCode()).isEqualTo("99213");
        assertThat(result.status()).isEqualToIgnoringCase("intake");
        assertThat(result.lob()).isEqualTo("commercial");
    }

    @Test
    void map_differentUrgencyCode_usesProfileMapping() {
        String fixture = MINIMAL_278.replace("UM*HS*I*2~", "UM*HS*I*1~");
        X12Transaction tx = new X12Parser().parse(fixture);
        TradingPartnerProfile profile = new TradingPartnerProfile(
                "commercial",
                Map.of("1", "standard", "2", "expedited")
        );

        Case result = mapper.map(tx, "test-tenant", profile);

        assertThat(result.urgency()).isEqualToIgnoringCase("standard");
    }

    @Test
    void map_unknownUrgencyCode_defaultsToStandard() {
        String fixture = MINIMAL_278.replace("UM*HS*I*2~", "UM*HS*I*9~");
        X12Transaction tx = new X12Parser().parse(fixture);
        TradingPartnerProfile profile = new TradingPartnerProfile(
                "medicaid",
                Map.of("1", "standard", "2", "expedited")
        );

        Case result = mapper.map(tx, "test-tenant", profile);

        assertThat(result.urgency()).isEqualToIgnoringCase("standard");
    }

    @Test
    void map_diagnosisCode_stripsQualifierPrefix() {
        X12Transaction tx = new X12Parser().parse(MINIMAL_278);
        TradingPartnerProfile profile = new TradingPartnerProfile(
                "commercial", Map.of("2", "expedited")
        );

        Case result = mapper.map(tx, "test-tenant", profile);

        assertThat(result.serviceLines().get(0).diagnosisCodes())
                .containsExactly("M5410");
    }
}
