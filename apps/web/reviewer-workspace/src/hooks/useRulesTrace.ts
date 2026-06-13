import type { TraceCriterion } from '../types.js';

export function useRulesTrace(_traceRef: string | null) {
  return {
    criteria: [] as TraceCriterion[],
    loading: false,
    error: null as string | null,
  };
}
