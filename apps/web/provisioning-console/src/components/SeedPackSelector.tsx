import { useState, useEffect } from 'react';
import type { SeedPack } from '../api/vkasClient.js';
import { vkasClient } from '../api/vkasClient.js';

interface Props {
  lob: string;
  onSelect: (canonicalUrl: string) => void;
  selected?: string;
}

export function SeedPackSelector({ lob, onSelect, selected }: Props) {
  const [packs, setPacks] = useState<SeedPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    vkasClient
      .getSeedPacks(lob)
      .then((data) => {
        if (!cancelled) {
          // Filter client-side to only show packs matching the requested lob
          setPacks(data.filter((p) => p.lob === lob));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load seed packs');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [lob]);

  if (loading) return <div>Loading seed packs…</div>;
  if (error) return <div role="alert">{error}</div>;
  if (packs.length === 0) return <div>No seed packs available for {lob}.</div>;

  return (
    <fieldset>
      <legend>Available seed packs</legend>
      {packs.map((pack) => (
        <div key={pack.canonical_url}>
          <label>
            <input
              type="radio"
              name="seed_pack"
              value={pack.canonical_url}
              checked={selected === pack.canonical_url}
              onChange={() => onSelect(pack.canonical_url)}
            />
            {' '}
            {pack.canonical_url} <span>v{pack.version}</span>
          </label>
        </div>
      ))}
    </fieldset>
  );
}
