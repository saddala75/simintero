interface ActionBarProps {
  roles: string[];
  caseId: string;
  onRequestInfo: () => void;
  onRoute: () => void;
  onRecordDetermination: () => void;
}

export function ActionBar({
  roles,
  onRequestInfo,
  onRoute,
  onRecordDetermination,
}: ActionBarProps) {
  const isMedicalDirector = roles.includes('medical_director');

  return (
    <div className="action-bar">
      <button className="action-bar__btn action-bar__btn--request-info" onClick={onRequestInfo}>
        Request Additional Info
      </button>
      <button className="action-bar__btn action-bar__btn--route" onClick={onRoute}>
        Route to Peer Review
      </button>
      {isMedicalDirector && (
        <button
          className="action-bar__btn action-bar__btn--record-determination"
          onClick={onRecordDetermination}
        >
          Record Determination
        </button>
      )}
    </div>
  );
}
