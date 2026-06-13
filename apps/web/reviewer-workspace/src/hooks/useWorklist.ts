import type { CaseListItem } from '../types.js';

export function useWorklist(_params?: { state?: string; lob?: string }) {
  return {
    cases: [] as CaseListItem[],
    loading: false,
    error: null as string | null,
    loadMore: () => {},
  };
}
