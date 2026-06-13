import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface SearchResult {
  entity_type: string;
  entity_id: string;
  metadata: Record<string, string>;
  score: number;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  query_hash: string;
}

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  const { data, isLoading, isError } = useQuery<SearchResponse>({
    queryKey: ['search', submittedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(submittedQuery)}`);
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      return res.json() as Promise<SearchResponse>;
    },
    enabled: submittedQuery.length > 0,
  });

  function handleSubmit() {
    if (query.trim()) setSubmittedQuery(query.trim());
  }

  // Group results by entity_type
  const byType = (data?.results ?? []).reduce<Record<string, SearchResult[]>>((acc, r) => {
    acc[r.entity_type] = [...(acc[r.entity_type] ?? []), r];
    return acc;
  }, {});

  return (
    <div className="search-panel">
      <div className="search-panel__input-row">
        <input
          data-testid="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="Search cases, documents, gaps…"
          aria-label="Search"
        />
        <button onClick={handleSubmit} disabled={isLoading}>
          {isLoading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {isError && (
        <p role="alert" className="search-panel__error">
          Search failed — check that the search service is running
        </p>
      )}

      {submittedQuery.length === 0 && (
        <p data-testid="search-empty-state" className="search-panel__empty">
          Enter a query to search across cases, documents, and gaps.
        </p>
      )}

      {data && data.results.length === 0 && (
        <p className="search-panel__no-results">No results for "{submittedQuery}"</p>
      )}

      {Object.entries(byType).map(([entityType, results]) => (
        <section key={entityType} className="search-panel__group">
          <h3 className="search-panel__group-title">{entityType}</h3>
          {results.map((r) => (
            <div key={r.entity_id} data-testid={`search-result-${r.entity_id}`} className="search-panel__result">
              <span className="search-panel__entity-id">{r.entity_id}</span>
              {Object.entries(r.metadata).map(([k, v]) => (
                <span key={k} className="search-panel__meta">{k}: {v}</span>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
