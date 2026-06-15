package com.simintero.enstellar.interop.decision;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA repository for the decision_store table.
 *
 * All queries include tenant_id as a predicate to enforce tenant isolation
 * (INVARIANT #5).
 */
@Repository
public interface DecisionStore extends JpaRepository<DecisionRecord, Long> {

    /**
     * Primary $inquire lookup — find by the correlation ID used at $submit time.
     *
     * Returns empty Optional if:
     *   - No matching correlation_id in this tenant (case doesn't exist)
     *   - tenant_id mismatch (cross-tenant attempt, silently returns empty)
     */
    Optional<DecisionRecord> findByCorrelationIdAndTenantId(
            String correlationId, String tenantId);

    /**
     * DecisionEventConsumer lookup — find by case_id to update the record
     * when decision.recorded arrives.
     */
    Optional<DecisionRecord> findByCaseIdAndTenantId(
            UUID caseId, String tenantId);
}
