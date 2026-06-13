import { useState, useCallback } from 'react';
import type { DeterminationOutcome } from '../types.js';
import { useCaseDetail } from '../hooks/useCaseDetail.js';
import { useRulesTrace } from '../hooks/useRulesTrace.js';
import { useAdvisory } from '../hooks/useAdvisory.js';
import { ServiceLineTable } from '../components/ServiceLineTable.js';
import { RulesTracePanel } from '../components/RulesTracePanel.js';
import { AdvisoryPanel } from '../components/AdvisoryPanel.js';
import { ActionBar } from '../components/ActionBar.js';
import { DeterminationModal } from '../components/DeterminationModal.js';
import { gqlRequest } from '../api/client.js';
import { useSimCtx } from '../api/context.js';
import { RECORD_DECISION_MUTATION, ROUTE_CASE_MUTATION } from '../graphql/mutations.js';

interface CaseReviewProps {
  caseId: string;
  roles: string[];
}

export function CaseReview({ caseId, roles }: CaseReviewProps) {
  const ctx = useSimCtx();
  const [showModal, setShowModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const { caseDetail, loading, error } = useCaseDetail(caseId);
  const { criteria } = useRulesTrace(caseId);
  const { advisory } = useAdvisory(caseId);

  const handleRequestInfo = useCallback(async () => {
    setActionError(null);
    setActionPending(true);
    try {
      const data = await gqlRequest<{ routeCase: { taskId: string | null; error: string | null } }>(
        ROUTE_CASE_MUTATION,
        { input: { caseId, toQueue: 'rfi', reason: 'Additional information requested by reviewer' } },
        ctx,
      );
      if (data.routeCase.error) setActionError(data.routeCase.error);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setActionPending(false);
    }
  }, [caseId, ctx]);

  const handleRoute = useCallback(async () => {
    setActionError(null);
    setActionPending(true);
    try {
      const data = await gqlRequest<{ routeCase: { taskId: string | null; error: string | null } }>(
        ROUTE_CASE_MUTATION,
        { input: { caseId, toQueue: 'peer_review', reason: 'Routed to peer review by reviewer' } },
        ctx,
      );
      if (data.routeCase.error) setActionError(data.routeCase.error);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setActionPending(false);
    }
  }, [caseId, ctx]);

  const handleSubmitDetermination = useCallback(async (outcome: DeterminationOutcome, rationale: string) => {
    setActionError(null);
    setActionPending(true);
    try {
      const data = await gqlRequest<{
        recordDecision: { determinationId: string | null; error: string | null; errorCode: string | null };
      }>(
        RECORD_DECISION_MUTATION,
        { input: { caseId, outcome, rationale } },
        ctx,
      );
      if (data.recordDecision.error) {
        setActionError(data.recordDecision.error);
      } else {
        setShowModal(false);
      }
    } catch (err) {
      setActionError(String(err));
    } finally {
      setActionPending(false);
    }
  }, [caseId, ctx]);

  if (loading) return <p>Loading case…</p>;
  if (error) return <p>Error: {error}</p>;
  if (!caseDetail) return <p>Case not found.</p>;

  return (
    <div className="case-review">
      <h1 className="case-review__title">Case Review: {caseDetail.case_id}</h1>

      {actionError && (
        <div className="case-review__action-error" role="alert">
          Action failed: {actionError}
        </div>
      )}

      <section className="case-review__section">
        <h2>Service Lines</h2>
        <ServiceLineTable lines={caseDetail.service_lines} />
      </section>

      <section className="case-review__section">
        <h2>Rules Trace</h2>
        <RulesTracePanel criteria={criteria} />
      </section>

      <section className="case-review__section">
        <h2>AI Advisory</h2>
        <AdvisoryPanel advisory={advisory} />
      </section>

      <ActionBar
        roles={roles}
        caseId={caseId}
        onRequestInfo={() => { void handleRequestInfo(); }}
        onRoute={() => { void handleRoute(); }}
        onRecordDetermination={() => setShowModal(true)}
        disabled={actionPending}
      />

      {showModal && (
        <DeterminationModal
          onSubmit={handleSubmitDetermination}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
