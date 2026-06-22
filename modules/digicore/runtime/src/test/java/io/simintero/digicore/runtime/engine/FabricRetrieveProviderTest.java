package io.simintero.digicore.runtime.engine;

import ca.uhn.fhir.context.FhirContext;
import org.hl7.fhir.r4.model.Condition;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcOperations;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

class FabricRetrieveProviderTest {

    private static final FhirContext FHIR = FhirContext.forR4();

    private List<Object> retrieveCondition(FabricRetrieveProvider p) {
        Iterable<Object> it = p.retrieve("Patient", "subject", "member-001", "Condition",
                null, null, null, null, null, null, null, null);
        List<Object> out = new ArrayList<>();
        it.forEach(out::add);
        return out;
    }

    @Test
    void parsesJsonContentIntoFhirResources() {
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-001") {
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
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-001") {
            @Override protected List<String> fetchContents(String resourceType) { return List.of(); }
        };
        assertTrue(retrieveCondition(provider).isEmpty());
    }

    @Test
    void propagatesFetchErrors() {
        var provider = new FabricRetrieveProvider(mock(JdbcOperations.class), FHIR, "tenant-dev", "member-001") {
            @Override protected List<String> fetchContents(String resourceType) { throw new RuntimeException("boom"); }
        };
        assertThrows(RuntimeException.class, () -> retrieveCondition(provider));
    }
}
