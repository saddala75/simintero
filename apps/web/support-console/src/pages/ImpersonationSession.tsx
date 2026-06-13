import { useState } from 'react';
import {
  supportConsoleClient,
  ImpersonationSession as SessionData,
} from '../api/supportConsoleClient.js';
import { ImpersonationBanner } from '../components/ImpersonationBanner.js';

export default function ImpersonationSession() {
  const [tenantId, setTenantId] = useState('');
  const [reason, setReason] = useState('');
  const [session, setSession] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const s = await supportConsoleClient.startImpersonation(tenantId, reason);
      setSession(s);
    } catch (err: unknown) {
      if (err instanceof Error) {
        const apiError = err as Error & { code?: string };
        if (apiError.code === 'SIM-PLAT-0020') {
          setError('Enclave tenants cannot be impersonated');
        } else {
          setError(apiError.message || 'An error occurred');
        }
      } else {
        setError('An error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEnd = async () => {
    if (session) {
      await supportConsoleClient.endImpersonation(session.session_token);
      setSession(null);
    }
  };

  if (session) {
    return (
      <div>
        <ImpersonationBanner session={session} onEnd={handleEnd} />
        <div style={{ marginTop: '60px' }}>
          <p>Session Token: {session.session_token}</p>
          <p>Tenant: {session.tenant_id}</p>
          <p>Expires: {session.expires_at}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Start Impersonation Session</h2>
      <form onSubmit={handleStart}>
        <div>
          <label htmlFor="tenantId">Tenant ID</label>
          <input
            id="tenantId"
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="reason">Reason</label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Starting...' : 'Start Session'}
        </button>
      </form>
    </div>
  );
}
