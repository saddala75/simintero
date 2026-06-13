import type { CaseListItem, ServiceLine } from '../types.js';

export interface CaseDetail extends CaseListItem {
  service_lines: ServiceLine[];
}

export function useCaseDetail(_caseId: string) {
  return {
    caseDetail: null as CaseDetail | null,
    loading: false,
    error: null as string | null,
  };
}
