package io.simintero.x12;

import io.simintero.x12.X12ParseException;
import io.simintero.x12.model.IntakeCommand;
import io.simintero.x12.x278.X278Parser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Round-trip tests for the X12 278 parser.
 * Uses a synthetic, non-PHI fixture string.
 */
class X278RoundTripTest {

    /**
     * Simplified X12 278 fixture (no real patient data).
     * BHT03=REF001, BHT06=13 (expedited), NM1*IL member=M123456789,
     * NM1*82 provider NPI=1234567890, REF*EA coverage=COV-001,
     * SV1*HC:27447 service line.
     */
    private static final String FIXTURE_278 =
            "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       " +
            "*260101*0900*^*00501*000000001*0*P*:~" +
            "GS*HI*SENDER*RECEIVER*20260101*0900*1*X*005010X217~" +
            "ST*278*0001~" +
            "BHT*0007*13*REF001*20260101*0900*13~" +
            "NM1*IL*1*DOE*JANE*M**MI*M123456789~" +
            "NM1*82*1*SMITH*JOHN***XX*1234567890~" +
            "REF*EA*COV-001~" +
            "SV1*HC:27447*500*UN*1***1~" +
            "SE*8*0001~" +
            "GE*1*1~" +
            "IEA*1*000000001~";

    private X278Parser parser;

    @BeforeEach
    void setUp() {
        parser = new X278Parser();
    }

    @Test
    void parsesChannelAsX12_278() {
        IntakeCommand command = parser.parse(FIXTURE_278);
        assertEquals("X12_278", command.channel());
    }

    @Test
    void extractsMemberRef() {
        IntakeCommand command = parser.parse(FIXTURE_278);
        assertNotNull(command.memberRef(), "memberRef should not be null");
        assertTrue(command.memberRef().startsWith("member:"),
                "memberRef should start with 'member:' but was: " + command.memberRef());
    }

    @Test
    void extractsUrgencyStandard() {
        // Replace BHT06=13 with BHT06=01 for standard urgency
        String standard278 =
                "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       " +
                "*260101*0900*^*00501*000000001*0*P*:~" +
                "GS*HI*SENDER*RECEIVER*20260101*0900*1*X*005010X217~" +
                "ST*278*0001~" +
                "BHT*0007*13*REF001*20260101*0900*01~" +
                "NM1*IL*1*DOE*JANE*M**MI*M123456789~" +
                "SE*4*0001~" +
                "GE*1*1~" +
                "IEA*1*000000001~";

        IntakeCommand command = parser.parse(standard278);
        assertEquals("standard", command.urgency());
    }

    @Test
    void extractsUrgencyExpedited() {
        IntakeCommand command = parser.parse(FIXTURE_278);
        assertEquals("expedited", command.urgency());
    }

    @Test
    void extractsServiceLineCode() {
        IntakeCommand command = parser.parse(FIXTURE_278);
        assertFalse(command.serviceLines().isEmpty(), "serviceLines should not be empty");
        boolean has27447 = command.serviceLines().stream()
                .anyMatch(sl -> "27447".equals(sl.code()));
        assertTrue(has27447, "Expected service line code '27447' in " + command.serviceLines());
    }

    @Test
    void rawPayloadRefIsSet() {
        IntakeCommand command = parser.parse(FIXTURE_278);
        assertNotNull(command.rawPayloadRef(), "rawPayloadRef should not be null");
        assertTrue(command.rawPayloadRef().startsWith("raw:"),
                "rawPayloadRef should start with 'raw:' but was: " + command.rawPayloadRef());
    }

    @Test
    void extractsExternalId() {
        IntakeCommand command = parser.parse(FIXTURE_278);
        assertFalse(command.externalIds().isEmpty(), "externalIds should not be empty");
        boolean hasBht03 = command.externalIds().stream()
                .anyMatch(id -> "x12-278-bht03".equals(id.system())
                        && "REF001".equals(id.value()));
        assertTrue(hasBht03,
                "Expected externalId {system=x12-278-bht03, value=REF001} in " + command.externalIds());
    }

    @Test
    void emptyBodyThrowsX12ParseException() {
        assertThrows(X12ParseException.class, () -> parser.parse(""),
                "parse(\"\") should throw X12ParseException");
    }

    @Test
    void sv1WithoutColonIsSkipped() {
        // SV1*27447~ (no colon composite) — service line should be skipped
        String fixture278NoColon =
                "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       " +
                "*260101*0900*^*00501*000000001*0*P*:~" +
                "GS*HI*SENDER*RECEIVER*20260101*0900*1*X*005010X217~" +
                "ST*278*0001~" +
                "BHT*0007*13*REF001*20260101*0900*13~" +
                "NM1*IL*1*DOE*JANE*M**MI*M123456789~" +
                "SV1*27447~" +
                "SE*6*0001~" +
                "GE*1*1~" +
                "IEA*1*000000001~";

        IntakeCommand command = parser.parse(fixture278NoColon);
        assertEquals(0, command.serviceLines().size(),
                "serviceLines should be empty when SV1 element has no ':' composite");
    }
}
