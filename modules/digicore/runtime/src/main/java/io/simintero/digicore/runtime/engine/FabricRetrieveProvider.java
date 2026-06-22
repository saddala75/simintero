package io.simintero.digicore.runtime.engine;

import ca.uhn.fhir.context.FhirContext;
import org.opencds.cqf.cql.engine.retrieve.RetrieveProvider;
import org.opencds.cqf.cql.engine.runtime.Code;
import org.opencds.cqf.cql.engine.runtime.Interval;
import org.springframework.jdbc.core.JdbcOperations;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;

/**
 * CQF {@link RetrieveProvider} that reads a member's FHIR R4 resources from the
 * {@code fabric.resource} Postgres table.
 *
 * <p>One instance is created per evaluation request: it holds the request's tenant and
 * member context. For slice 1.1 this is a <em>type-only</em> retrieve — only the
 * {@code dataType} (mapped to {@code resource_type}), the request tenant, and the
 * member_ref are used to filter; the code-filter / valueset / date arguments are
 * ignored.</p>
 *
 * <p>The runtime connects to Postgres as the non-superuser {@code sim_app}, so RLS
 * applies. The {@code fabric.resource} RLS policy is
 * {@code tenant_id = current_setting('sim.tenant_id', true)} with FORCE RLS, so the
 * {@code sim.tenant_id} GUC must be set on the <em>same</em> connection as the SELECT.
 * {@link #fetchContents(String)} follows the proven {@code TraceBuilder} pattern: set
 * the GUC and run the query inside one {@code jdbc.execute(ConnectionCallback)} with
 * autocommit disabled.</p>
 */
public class FabricRetrieveProvider implements RetrieveProvider {

    private final JdbcOperations jdbc;
    private final FhirContext fhir;
    private final String tenantId;
    private final String memberRef;

    public FabricRetrieveProvider(JdbcOperations jdbc, FhirContext fhir, String tenantId, String memberRef) {
        this.jdbc = jdbc;
        this.fhir = fhir;
        this.tenantId = tenantId;
        this.memberRef = memberRef;
    }

    @Override
    public Iterable<Object> retrieve(String context, String contextPath, Object contextValue,
                                     String dataType, String templateId, String codePath,
                                     Iterable<Code> codes, String valueSet,
                                     String datePath, String dateLowPath, String dateHighPath,
                                     Interval dateRange) {
        // Without tenant + member context there is nothing to scope a query to.
        if (tenantId == null || memberRef == null) {
            return List.of();
        }

        List<String> contents = fetchContents(dataType);
        List<Object> resources = new ArrayList<>(contents.size());
        for (String json : contents) {
            resources.add(fhir.newJsonParser().parseResource(json));
        }
        return resources;
    }

    /**
     * Fetch the raw JSON content of every {@code fabric.resource} row for this request's
     * tenant + member with the given {@code resource_type}.
     *
     * <p>Protected seam so tests can override it without a live database. The GUC and the
     * SELECT run on one connection in one transaction (autocommit off) so the
     * transaction-local {@code sim.tenant_id} set by {@code set_config(..., true)} is
     * visible to the RLS policy on the same connection. {@code content::text} is selected
     * (not the raw jsonb column) so the JDBC driver yields the JSON string rather than a
     * driver-specific PGobject.</p>
     *
     * <p>An empty result is the normal "no resources of this type" case — not an error.
     * Any SQL failure is rolled back and rethrown as a {@link RuntimeException}.</p>
     */
    protected List<String> fetchContents(String resourceType) {
        return jdbc.execute((Connection conn) -> {
            boolean priorAutoCommit = conn.getAutoCommit();
            conn.setAutoCommit(false);
            try {
                try (PreparedStatement guc =
                        conn.prepareStatement("SELECT set_config('sim.tenant_id', ?, true)")) {
                    guc.setString(1, tenantId);
                    guc.execute();
                }
                List<String> out = new ArrayList<>();
                try (PreparedStatement sel = conn.prepareStatement(
                        """
                        SELECT content::text
                        FROM fabric.resource
                        WHERE tenant_id = current_setting('sim.tenant_id', true)
                          AND resource_type = ?
                          AND member_ref = ?
                        """)) {
                    sel.setString(1, resourceType);
                    sel.setString(2, memberRef);
                    try (ResultSet rs = sel.executeQuery()) {
                        while (rs.next()) {
                            out.add(rs.getString(1));
                        }
                    }
                }
                conn.commit();
                return out;
            } catch (Exception inner) {
                conn.rollback();
                throw new RuntimeException(
                        "Failed to fetch fabric.resource rows for resourceType '" + resourceType + "'", inner);
            } finally {
                conn.setAutoCommit(priorAutoCommit);
            }
        });
    }
}
