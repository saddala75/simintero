package io.simintero.x12.controller;

import io.simintero.x12.x275.X275Parser;
import io.simintero.x12.x278.X278Parser;
import io.simintero.x12.x278.X278Serializer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * @WebMvcTest controller layer tests for TranslatorController.
 * Real parser/serializer beans are imported to avoid @MockBean byte-buddy issues on Java 21+.
 */
@WebMvcTest(TranslatorController.class)
@Import({X278Parser.class, X278Serializer.class, X275Parser.class})
class TranslatorControllerTest {

    /** Same 278 fixture used in X278RoundTripTest (no PHI). */
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

    /** Same 275 fixture used in X275ParserTest (no PHI). */
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

    @Autowired
    private MockMvc mockMvc;

    @Test
    void parse278ReturnsJson() throws Exception {
        mockMvc.perform(post("/x12/278/parse")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content(FIXTURE_278))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.channel").value("X12_278"));
    }

    @Test
    void parse275ReturnsJson() throws Exception {
        mockMvc.perform(post("/x12/275/parse")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content(FIXTURE_275))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.trnLinkage").exists());
    }

    @Test
    void parse278WithBlankBodyReturns400() throws Exception {
        mockMvc.perform(post("/x12/278/parse")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content(""))
                .andExpect(status().isBadRequest());
    }

    @Test
    void serialize278ReturnsText() throws Exception {
        String body = """
                {"caseRef":"case:001","outcome":"approved","rationale":"ok","perLine":[]}
                """;

        mockMvc.perform(post("/x12/278/serialize")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_PLAIN));
    }
}
