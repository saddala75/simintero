package com.simintero.enstellar.interop.attachments;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RfaiBuilderTest {

    @Test
    void buildContainsBerSegments() {
        String edi = RfaiBuilder.build("RFAI-001", "CLM-001", "case-001",
                List.of("11506-3", "18842-5"));
        assertThat(edi).startsWith("ISA*");
        assertThat(edi).contains("ST*277*");
        assertThat(edi).contains("TRN*1*RFAI-001");
        assertThat(edi).contains("PWK*");
        assertThat(edi).contains("11506-3");
        assertThat(edi).contains("18842-5");
        assertThat(edi).contains("IEA*");
    }

    @Test
    void buildMultipleLoincCodesProducesMultiplePwk() {
        String edi = RfaiBuilder.build("RFAI-002", "CLM-002", "case-002",
                List.of("11506-3", "47519-4", "60591-5"));
        long pwkCount = edi.lines().filter(l -> l.startsWith("PWK*")).count();
        assertThat(pwkCount).isEqualTo(3);
    }

    @Test
    void controlNumberIsTruncatedTo9Chars() {
        String rfaiId = "RFAI-VERY-LONG-ID-12345";
        String edi = RfaiBuilder.build(rfaiId, "CLM", "case", List.of("11506-3"));
        // Control numbers in ISA are 9 characters
        String[] isaFields = edi.split("\\*");
        assertThat(isaFields[13].trim()).hasSize(9);
    }
}
