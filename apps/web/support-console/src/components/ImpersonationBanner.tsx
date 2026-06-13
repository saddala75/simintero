import { ImpersonationSession } from '../api/supportConsoleClient.js';

interface Props {
  session: ImpersonationSession;
  onEnd: () => void;
}

export function ImpersonationBanner({ session, onEnd }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: 'orange',
        padding: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 1000,
      }}
    >
      <span>
        ⚠ Impersonating: {session.tenant_id} | Session expires: {session.expires_at}
      </span>
      <button onClick={onEnd}>End Session</button>
    </div>
  );
}
