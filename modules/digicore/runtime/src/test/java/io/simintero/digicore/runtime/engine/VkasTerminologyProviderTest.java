package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.opencds.cqf.cql.engine.runtime.Code;
import org.opencds.cqf.cql.engine.terminology.ValueSetInfo;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class VkasTerminologyProviderTest {
    private static final String VS_URL = "http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498";
    private static final ObjectMapper M = new ObjectMapper();

    private VkasClient vkasReturning(String json) throws Exception {
        VkasClient c = mock(VkasClient.class);
        when(c.resolveContent(eq(VS_URL), any(), any())).thenReturn(Optional.of(M.readTree(json)));
        return c;
    }
    private static final String KNEE_VS = """
        {"resourceType":"ValueSet","url":"%s","expansion":{"contains":[
          {"system":"http://snomed.info/sct","code":"239873007","display":"Osteoarthritis of knee"},
          {"system":"http://hl7.org/fhir/sid/icd-10-cm","code":"M17.0","display":"x"}]}}
        """.formatted(VS_URL);

    @Test void expandReturnsSeededCodes() throws Exception {
        var p = new VkasTerminologyProvider(vkasReturning(KNEE_VS));
        var codes = p.expand(new ValueSetInfo().withId(VS_URL));
        long n = 0; boolean sawSnomed = false;
        for (Code c : codes) { n++; if ("239873007".equals(c.getCode()) && "http://snomed.info/sct".equals(c.getSystem())) sawSnomed = true; }
        assertEquals(2, n); assertTrue(sawSnomed);
    }
    @Test void inMembershipMatchesBySystemAndCode() throws Exception {
        var p = new VkasTerminologyProvider(vkasReturning(KNEE_VS));
        var vs = new ValueSetInfo().withId(VS_URL);
        assertTrue(p.in(new Code().withSystem("http://snomed.info/sct").withCode("239873007"), vs));
        assertFalse(p.in(new Code().withSystem("http://snomed.info/sct").withCode("99999999"), vs));
    }
    @Test void unresolvableValueSetThrows() {
        VkasClient c = mock(VkasClient.class);
        when(c.resolveContent(any(), any(), any())).thenReturn(Optional.empty());
        var p = new VkasTerminologyProvider(c);
        assertThrows(RuntimeException.class, () -> p.expand(new ValueSetInfo().withId("http://unknown/vs")));
    }
}
