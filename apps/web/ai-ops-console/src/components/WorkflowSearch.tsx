import { useState } from 'react';

interface WorkflowActivity {
  name: string;
  status: string;
  startedAt: string;
}

interface WorkflowResult {
  workflowId: string;
  status: string;
  activities: WorkflowActivity[];
}

interface WorkflowSearchProps {
  onResult: (result: WorkflowResult) => void;
}

export function WorkflowSearch({ onResult }: WorkflowSearchProps) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(query.trim())}`);
      if (!res.ok) {
        setError(res.status === 404 ? 'Workflow not found' : `Error ${res.status}`);
        return;
      }
      const data = (await res.json()) as WorkflowResult;
      onResult(data);
    } catch {
      setError('Network error — check that the Temporal proxy is running');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="workflow-search">
      <label htmlFor="workflow-search-input" className="sr-only">
        Search by correlation ID
      </label>
      <input
        id="workflow-search-input"
        role="searchbox"
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && void handleSearch()}
        placeholder="Enter case ID or correlation ID…"
        className="workflow-search__input"
      />
      <button
        onClick={() => void handleSearch()}
        disabled={loading}
        aria-label="Search"
        className="workflow-search__button"
      >
        {loading ? 'Searching…' : 'Search'}
      </button>
      {error && (
        <div role="alert" className="workflow-search__error">
          {error}
        </div>
      )}
    </div>
  );
}
