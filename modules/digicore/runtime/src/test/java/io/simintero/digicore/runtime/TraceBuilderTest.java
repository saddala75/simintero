package io.simintero.digicore.runtime;

import io.simintero.digicore.runtime.trace.TraceBuilder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcOperations;

import java.util.ArrayList;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for the Task 2.5 TraceBuilder outbox persistence.
 * Uses Mockito to verify JDBC interactions without a real database.
 */
class TraceBuilderTest {

    private JdbcOperations mockJdbc;
    private TraceBuilder builder;

    @BeforeEach
    void setUp() {
        mockJdbc = mock(JdbcOperations.class);
        builder = new TraceBuilder(mockJdbc);
    }

    @Test
    void newTraceRef_returnsUrnWithTracePrefix() {
        String ref = builder.newTraceRef();
        assertTrue(ref.startsWith("trace:"), "No-arg newTraceRef() must produce a 'trace:' prefixed URN");
    }

    @Test
    void newTraceRef_noArg_doesNotTouchJdbc() {
        builder.newTraceRef();
        verifyNoInteractions(mockJdbc);
    }

    @Test
    void newTraceRef_withTenantId_returnsUrnWithTracePrefix() {
        String ref = builder.newTraceRef("t_001");
        assertTrue(ref.startsWith("trace:"), "newTraceRef(tenantId) must produce a 'trace:' prefixed URN");
    }

    @Test
    void newTraceRef_withTenantId_insertsToOutbox() {
        when(mockJdbc.update(anyString(), any(), any(), any(), any())).thenReturn(1);

        String ref = builder.newTraceRef("t_001");

        assertTrue(ref.startsWith("trace:"));
        verify(mockJdbc, times(1)).update(
            contains("shared.outbox"),
            any(),    // eventId (UUID string)
            any(),    // traceRef key
            argThat((String s) -> s.contains("\"tenant_id\":\"t_001\"")),
            eq("t_001")
        );
    }

    @Test
    void newTraceRef_withTenantId_doesNotThrowOnJdbcFailure() {
        when(mockJdbc.update(anyString(), any(), any(), any(), any()))
            .thenThrow(new RuntimeException("DB unavailable"));

        // Must not propagate the exception — trace ref still returned
        assertDoesNotThrow(() -> {
            String ref = builder.newTraceRef("t_001");
            assertNotNull(ref);
            assertTrue(ref.startsWith("trace:"));
        });
    }

    @Test
    void buildLogicPath_returnsImmutableCopy() {
        var steps = new ArrayList<Map<String, Object>>();
        steps.add(Map.of("expression_name", "Requirement Met", "result", "true"));

        var path = builder.buildLogicPath(steps);

        assertEquals(1, path.size());
        assertThrows(UnsupportedOperationException.class,
            () -> path.add(Map.of("expression_name", "extra", "result", "false")),
            "buildLogicPath must return an unmodifiable list");
    }
}
