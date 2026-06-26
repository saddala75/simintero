package com.simintero.enstellar.interop.attachments;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class X12v6020AttachmentParserTest {

    private static final String SAMPLE_EDI = """
            ISA*00*          *00*          *ZZ*PROVIDER        *ZZ*SIMINTERO       *260101*1200*^*00601*CTRL00001*0*P*:
            GS*AR*PROVIDER*SIMINTERO*20260101*1200*1*X*006020
            ST*275*0001*005010X210
            BGN*11*CTRL00001*20260101*1200*UT*ORIGINAL**2
            NM1*1P*2*PROVIDER NETWORK*****XX*1234567890
            NM1*PR*2*SIMINTERO HEALTH*****PI*SIM001
            TRN*1*RFAI-001*1SIMINTERO
            REF*EJ*CLM-TEST-001
            REF*SIM*tenant-dev
            PWK*01*EL*11506-3
            BIN*247*PD94bWwgdmVyc2lvbj0iMS4wIj8+PENsaW5pY2FsRG9jdW1lbnQ+PC9DbGluaWNhbERvY3VtZW50Pg==
            SE*12*0001
            GE*1*1
            IEA*1*CTRL00001
            """;

    @Test
    void parsesControlNumber() {
        ParsedAttachment275 result = X12v6020AttachmentParser.parse(SAMPLE_EDI);
        assertThat(result.controlNumber()).isEqualTo("RFAI-001");
    }

    @Test
    void parsesClaimId() {
        ParsedAttachment275 result = X12v6020AttachmentParser.parse(SAMPLE_EDI);
        assertThat(result.claimId()).isEqualTo("CLM-TEST-001");
    }

    @Test
    void parsesTenantId() {
        ParsedAttachment275 result = X12v6020AttachmentParser.parse(SAMPLE_EDI);
        assertThat(result.tenantId()).isEqualTo("tenant-dev");
    }

    @Test
    void parsesLoincCode() {
        ParsedAttachment275 result = X12v6020AttachmentParser.parse(SAMPLE_EDI);
        assertThat(result.loincCode()).isEqualTo("11506-3");
    }

    @Test
    void parsesCcdaBase64() {
        ParsedAttachment275 result = X12v6020AttachmentParser.parse(SAMPLE_EDI);
        assertThat(result.ccdaBase64()).isNotBlank();
        assertThat(result.ccdaBase64()).startsWith("PD94"); // base64 for <?xml
    }

    @Test
    void throwsOnMalformedEdi() {
        assertThatThrownBy(() -> X12v6020AttachmentParser.parse("NOT EDI"))
            .isInstanceOf(AttachmentParseException.class);
    }
}
