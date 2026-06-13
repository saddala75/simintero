package io.simintero.x12;

import io.simintero.x12.X12ParseException;
import io.simintero.x12.model.DocumentReference;
import io.simintero.x12.x275.X275Parser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for the X12 275 parser.
 * Uses a synthetic, non-PHI fixture string.
 */
class X275ParserTest {

    /**
     * Simplified X12 275 fixture (no real patient data).
     * TRN*1*TRN-REF-999, NM1*41 provider org.
     */
    private static final String FIXTURE_275 =
            "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       " +
            "*260101*0900*^*00501*000000001*0*P*:~" +
            "GS*HI*SENDER*RECEIVER*20260101*0900*1*X*005010X210~" +
            "ST*275*0001~" +
            "BGN*11*REF001*20260101*0900****2~" +
            "NM1*41*2*PROVIDER ORG***XX*1234567890~" +
            "TRN*1*TRN-REF-999*1234567890~" +
            "SE*5*0001~" +
            "GE*1*1~" +
            "IEA*1*000000001~";

    private X275Parser parser;

    @BeforeEach
    void setUp() {
        parser = new X275Parser();
    }

    @Test
    void extractsTrnLinkage() {
        DocumentReference ref = parser.parse(FIXTURE_275);
        assertNotNull(ref.trnLinkage(), "trnLinkage should not be null");
        assertEquals("x12-275-trn", ref.trnLinkage().system(),
                "trnLinkage.system should be 'x12-275-trn'");
        assertEquals("TRN-REF-999", ref.trnLinkage().value(),
                "trnLinkage.value should be 'TRN-REF-999'");
    }

    @Test
    void rawPayloadRefIsSet() {
        DocumentReference ref = parser.parse(FIXTURE_275);
        assertNotNull(ref.rawPayloadRef(), "rawPayloadRef should not be null");
        assertTrue(ref.rawPayloadRef().startsWith("raw:"),
                "rawPayloadRef should start with 'raw:' but was: " + ref.rawPayloadRef());
    }

    @Test
    void emptyBodyThrowsX12ParseException() {
        assertThrows(X12ParseException.class, () -> parser.parse(""),
                "parse(\"\") should throw X12ParseException");
    }
}
