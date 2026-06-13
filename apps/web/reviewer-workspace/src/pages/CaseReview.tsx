import { useState } from 'react';
import type { DeterminationOutcome } from '../types.js';
import { useCaseDetail } from '../hooks/useCaseDetail.js';
import { useRulesTrace } from '../hooks/useRulesTrace.js';
import { ServiceLineTable } from '../components/ServiceLineTable.js';
import { RulesTracePanel } from '../components/RulesTracePanel.js';
import { AdvisoryPanel } from '../components/AdvisoryPanel.js';
import { ActionBar } from '../components/ActionBar.js';
import { DeterminationModal } from '../components/DeterminationModal.js';

interface CaseReviewProps {
  caseId: string;
  roles: string[];
}

export function CaseReview({ caseId, roles }: CaseReviewProps) {
  const [showModal, setShowModal] = useState(false);
  const { caseDetail, loading, error } = useCaseDetail(caseId);
  const { criteria } = useRulesTrace(caseId);

  function handleRequestInfo() {
    // TODO: trigger route mutation
  }

  function handleRoute() {
    // TODO: trigger route mutation
  }

  function handleRecordDetermination() {
    setShowModal(true);
  }

  function handleSubmitDetermination(_outcome: DeterminationOutcome, _rationale: string) {
    // TODO: trigger recordDecision mutation
    setShowModal(false);
  }

  if (loading) return <p>Loading case…</p>;
  if (error) return <p>Error: {error}</p>;
  if (!caseDetail) return <p>Case not found.</p>;

  return (
    <div className="case-review">
      <h1 className="case-review__title">Case Review: {caseDetail.case_id}</h1>

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
        <AdvisoryPanel advisory={null} />
      </section>

      <ActionBar
        roles={roles}
        caseId={caseId}
        onRequestInfo={handleRequestInfo}
        onRoute={handleRoute}
        onRecordDetermination={handleRecordDetermination}
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
