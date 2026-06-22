package io.simintero.digicore.runtime.engine;

import ca.uhn.fhir.context.FhirContext;
import org.hl7.fhir.r4.model.Condition;
import org.junit.jupiter.api.Test;
import org.opencds.cqf.cql.engine.runtime.Code;
import org.opencds.cqf.cql.engine.terminology.CodeSystemInfo;
import org.opencds.cqf.cql.engine.terminology.TerminologyProvider;
import org.opencds.cqf.cql.engine.terminology.ValueSetInfo;
import org.springframework.jdbc.core.JdbcOperations;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

class FabricRetrieveProviderTest {

    private static final FhirContext FHIR = FhirContext.forR4();

    private static final String COND_MATCH = "{\"resourceType\":\"Condition\",\"id\":\"c1\",\"code\":{\"coding\":[{\"system\":\"http://snomed.info/sct\",\"code\":\"239873007\"}]}}";
    private static final String COND_NONMATCH = "{\"resourceType\":\"Condition\",\"id\":\"c2\",\"code\":{\"coding\":[{\"system\":\"http://snomed.info/sct\",\"code\":\"99999999\"}]}}";

    private List<Object> toList(Iterable<Object> it) {
        List<Object> out = new ArrayList<>();
        it.forEach(out::add);
        return out;
    }

    private List<Object> retrieveCondition(FabricRetrieveProvider p) {
        return toList(p.retrieve("Patient", "subject", "member-001", "Condition",
                null, null, null, null, null, null, null, null));
    }

    // A TerminologyProvider whose expand() returns a fixed set; in() uses VkasTerminologyProvider.codesMatch.
    private TerminologyProvider fakeTerm(List<Code> members) {
        return new TerminologyProvider() {
            public Iterable<Code> expand(ValueSetInfo vs) { return members; }
            public boolean in(Code c, ValueSetInfo vs) { return members.stream().anyMatch(m -> VkasTerminologyProvider.codesMatch(m, c)); }
            public Code lookup(Code c, CodeSystemInfo cs) { throw new UnsupportedOperationException(); }
        };
    }

    private TerminologyProvider throwingTerm() {
        return new TerminologyProvider() {
            public Iterable<Code> expand(ValueSetInfo vs) { throw new IllegalStateException("unresolvable"); }
            public boolean in(Code c, ValueSetInfo vs) { throw new IllegalStateException(); }
            public Code lookup(Code c, CodeSystemInfo cs) { throw new UnsupportedOperationException(); }
        };
    }

    @Test
    void parsesJsonContentIntoFhirResources() {
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-001", throwingTerm()) {
            @Override protected List<String> fetchContents(String resourceType) {
                return List.of("{\"resourceType\":\"Condition\",\"id\":\"cond-001\"}");
            }
        };
        var list = retrieveCondition(provider);
        assertEquals(1, list.size());
        assertInstanceOf(Condition.class, list.get(0));
        assertEquals("cond-001", ((Condition) list.get(0)).getIdElement().getIdPart());
    }

    @Test
    void returnsEmptyWhenNoRows() {
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-001", throwingTerm()) {
            @Override protected List<String> fetchContents(String resourceType) { return List.of(); }
        };
        assertTrue(retrieveCondition(provider).isEmpty());
    }

    @Test
    void propagatesFetchErrors() {
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-001", throwingTerm()) {
            @Override protected List<String> fetchContents(String resourceType) { throw new RuntimeException("boom"); }
        };
        assertThrows(RuntimeException.class, () -> retrieveCondition(provider));
    }

    @Test
    void valueSetRetrieveKeepsMatchingDropsNonMatching() {
        var members = List.of(new Code().withSystem("http://snomed.info/sct").withCode("239873007"));
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-001", fakeTerm(members)) {
            @Override protected List<String> fetchContents(String t) { return List.of(COND_MATCH, COND_NONMATCH); }
        };
        var out = toList(provider.retrieve("Patient", "subject", "member-001", "Condition", null, "code", null, "http://vs", null, null, null, null));
        assertEquals(1, out.size());
        assertEquals("c1", ((Condition) out.get(0)).getIdElement().getIdPart());
    }

    @Test
    void valueSetRetrieveNotMetWhenOnlyNonMatching() {
        var members = List.of(new Code().withSystem("http://snomed.info/sct").withCode("239873007"));
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-002", fakeTerm(members)) {
            @Override protected List<String> fetchContents(String t) { return List.of(COND_NONMATCH); }
        };
        assertTrue(toList(provider.retrieve("Patient", "subject", "member-002", "Condition", null, "code", null, "http://vs", null, null, null, null)).isEmpty());
    }

    @Test
    void unresolvableValueSetThrows() {
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-001", throwingTerm()) {
            @Override protected List<String> fetchContents(String t) { return List.of(COND_MATCH); }
        };
        assertThrows(RuntimeException.class, () -> toList(provider.retrieve("Patient", "subject", "member-001", "Condition", null, "code", null, "http://vs", null, null, null, null)));
    }

    @Test
    void typeOnlyRetrieveStillReturnsAll() {
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-001", throwingTerm()) {
            @Override protected List<String> fetchContents(String t) { return List.of(COND_MATCH, COND_NONMATCH); }
        };
        assertEquals(2, toList(provider.retrieve("Patient", "subject", "member-001", "Condition", null, null, null, null, null, null, null, null)).size());
    }

    @Test
    void codePathWithoutValueSetOrCodesFailsClosed() {
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-001", fakeTerm(List.of())) {
            @Override protected List<String> fetchContents(String t) { return List.of(COND_MATCH); }
        };
        assertThrows(RuntimeException.class, () -> toList(provider.retrieve("Patient", "subject", "member-001", "Condition", null, "code", null, null, null, null, null, null)));
    }
}
