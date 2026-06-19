package io.simintero.digicore.runtime.trace;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Phase 2 TraceBuilder.
 *
 * Generates a {@code trace_ref} (a URN wrapping a random UUID).  When a tenant ID is
 * available the creation event is persisted to {@code shared.outbox} via JDBC so that
 * the outbox relay can fan it out to downstream consumers.
 *
 * The outbox write is non-fatal: if JDBC fails the {@code trace_ref} is still returned
 * so evaluation can proceed.
 */
@Component
public class TraceBuilder {

    private static final Logger log = LoggerFactory.getLogger(TraceBuilder.class);

    private final JdbcOperations jdbc;

    public TraceBuilder(JdbcOperations jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Build a trace reference token without persisting to the outbox.
     * Use this when tenant context is unavailable.
     *
     * @return a string of the form {@code trace:<uuid>}
     */
    public String newTraceRef() {
        return "trace:" + UUID.randomUUID();
    }

    /**
     * Build a trace reference token AND persist a {@code sim.case.trace/TraceCreated/v1}
     * event to {@code shared.outbox} for the given tenant.
     *
     * @param tenantId the tenant owning this trace (used for outbox RLS)
     * @return a string of the form {@code trace:<uuid>}
     */
    public String newTraceRef(String tenantId) {
        String traceRef = "trace:" + UUID.randomUUID();
        String eventId = UUID.randomUUID().toString();
        try {
            // The shared.outbox table is FORCE-RLS: an INSERT only succeeds when the
            // sim.tenant_id GUC is set on the SAME connection within the same
            // transaction. JdbcOperations.update() may grab a different pooled
            // connection per call, and set_config(..., true) is transaction-local, so
            // both statements are executed inside a single ConnectionCallback with
            // autocommit disabled. This guarantees one connection AND one transaction:
            // the GUC set by set_config survives until the INSERT and the pair commits
            // atomically.
            String envelopeJson = buildEnvelopeJson(traceRef, tenantId, eventId);
            jdbc.execute((Connection conn) -> {
                boolean priorAutoCommit = conn.getAutoCommit();
                conn.setAutoCommit(false);
                try {
                    try (PreparedStatement guc =
                            conn.prepareStatement("SELECT set_config('sim.tenant_id', ?, true)")) {
                        guc.setString(1, tenantId);
                        guc.execute();
                    }
                    try (PreparedStatement ins = conn.prepareStatement(
                            """
                            INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
                            VALUES (?, 'sim.case.trace', ?, ?::jsonb, ?)
                            ON CONFLICT (event_id) DO NOTHING
                            """)) {
                        ins.setString(1, eventId);
                        ins.setString(2, traceRef);
                        ins.setString(3, envelopeJson);
                        ins.setString(4, tenantId);
                        ins.executeUpdate();
                    }
                    conn.commit();
                } catch (Exception inner) {
                    conn.rollback();
                    throw inner;
                } finally {
                    conn.setAutoCommit(priorAutoCommit);
                }
                return null;
            });
        } catch (Exception e) {
            // Non-fatal: outbox write failure must not block evaluation
            log.warn("Failed to persist trace event to shared.outbox for tenant '{}': {}", tenantId, e.getMessage());
        }
        return traceRef;
    }

    /**
     * Build the logic path from per-step results produced by
     * {@link io.simintero.digicore.runtime.engine.ElmEvaluator}.
     * The list is passed through unchanged; Phase 3 may enrich with FHIR resource refs.
     *
     * @param steps ordered list of {expression_name, result} maps from the evaluator
     * @return immutable copy of the logic path
     */
    public List<Map<String, Object>> buildLogicPath(List<Map<String, Object>> steps) {
        return List.copyOf(steps);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private String buildEnvelopeJson(String traceRef, String tenantId, String eventId) {
        return String.format(
            "{\"event_id\":\"%s\",\"schema_ref\":\"sim.case.trace/TraceCreated/v1\",\"payload\":{\"trace_ref\":\"%s\",\"tenant_id\":\"%s\"}}",
            eventId, traceRef, tenantId
        );
    }
}
