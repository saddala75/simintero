package io.simintero.digicore.runtime;

import io.simintero.digicore.runtime.trace.TraceBuilder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcOperations;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
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
    @SuppressWarnings("unchecked")
    void newTraceRef_withTenantId_setsGucBeforeInsertOnSameConnection() throws Exception {
        // Record the SQL prepared on the connection, in order, plus the tenant id bound
        // to set_config, so we can assert set_config precedes the INSERT on ONE connection.
        List<String> preparedSql = new ArrayList<>();
        List<String> gucBindings = new ArrayList<>();

        Connection conn = mock(Connection.class);
        when(conn.getAutoCommit()).thenReturn(true);
        when(conn.prepareStatement(anyString())).thenAnswer(inv -> {
            String sql = inv.getArgument(0);
            preparedSql.add(sql);
            PreparedStatement ps = mock(PreparedStatement.class);
            if (sql.contains("set_config('sim.tenant_id'")) {
                doAnswer(b -> { gucBindings.add(b.getArgument(1)); return null; })
                    .when(ps).setString(eq(1), anyString());
            }
            return ps;
        });

        when(mockJdbc.execute(any(ConnectionCallback.class))).thenAnswer(inv ->
            ((ConnectionCallback<Object>) inv.getArgument(0)).doInConnection(conn));

        String ref = builder.newTraceRef("t_001");

        assertTrue(ref.startsWith("trace:"));
        int guc = -1, ins = -1;
        for (int i = 0; i < preparedSql.size(); i++) {
            if (preparedSql.get(i).contains("set_config('sim.tenant_id'")) guc = i;
            if (preparedSql.get(i).contains("shared.outbox")) ins = i;
        }
        assertTrue(guc >= 0, "set_config must be executed");
        assertTrue(ins > guc, "INSERT must run after set_config on the same connection");
        assertTrue(gucBindings.contains("t_001"), "set_config must bind the tenant id");
        // One transaction: autocommit disabled then committed exactly once
        verify(conn).setAutoCommit(false);
        verify(conn).commit();
    }

    @Test
    void newTraceRef_withTenantId_doesNotThrowOnJdbcFailure() {
        when(mockJdbc.execute(any(ConnectionCallback.class)))
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
