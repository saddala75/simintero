interface ActionBarProps {
  roles: string[];
  caseId: string;
  onRequestInfo: () => void;
  onRoute: () => void;
  onRecordDetermination: () => void;
  disabled?: boolean;
}

export function ActionBar({
  roles,
  onRequestInfo,
  onRoute,
  onRecordDetermination,
  disabled = false,
}: ActionBarProps) {
  const isMedicalDirector = roles.includes('medical_director');

  return (
    <div className="action-bar">
      <button
        className="action-bar__btn action-bar__btn--request-info"
        onClick={onRequestInfo}
        disabled={disabled}
      >
        Request Additional Info
      </button>
      <button
        className="action-bar__btn action-bar__btn--route"
        onClick={onRoute}
        disabled={disabled}
      >
        Route to Peer Review
      </button>
      {isMedicalDirector && (
        <button
          className="action-bar__btn action-bar__btn--record-determination"
          onClick={onRecordDetermination}
          disabled={disabled}
        >
          Record Determination
        </button>
      )}
    </div>
  );
}
