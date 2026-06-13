import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestAdvisoryAnalysis, setRevitalClient } from '../activities/requestAdvisoryAnalysis.js';
import type { RevitalClient } from '../clients/RevitalClient.js';

describe('requestAdvisoryAnalysis', () => {
  const mockClient: RevitalClient = {
    requestAnalysis: vi.fn(),
    getAnalysis: vi.fn(),
  };

  beforeEach(() => {
    setRevitalClient(mockClient);
    vi.clearAllMocks();
  });

  it('returns accepted tracking result when Revital responds', async () => {
    vi.mocked(mockClient.requestAnalysis).mockResolvedValue({
      analysis_id: 'ana-001',
      operation: 'analyses/ana-001',
    });

    const result = await requestAdvisoryAnalysis({
      caseId: 'c_001',
      documentRefs: ['doc-a', 'doc-b'],
      lob: 'MA',
      urgency: 'standard',
    });

    expect(result).toEqual({ analysis_id: 'ana-001', status: 'accepted' });
    expect(mockClient.requestAnalysis).toHaveBeenCalledWith({
      case_ref: 'c_001',
      analysis_kinds: ['summary', 'extraction', 'completeness', 'triage'],
      inputs: {
        document_refs: ['doc-a', 'doc-b'],
        case_context: { lob: 'MA', urgency: 'standard', service_lines: [] },
      },
      priority: 'interactive',
    });
  });

  it('returns null when Revital throws (graceful degradation)', async () => {
    vi.mocked(mockClient.requestAnalysis).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await requestAdvisoryAnalysis({
      caseId: 'c_002',
      documentRefs: [],
      lob: 'MA',
      urgency: 'expedited',
    });

    expect(result).toBeNull();
  });

  it('passes caseId as case_ref to requestAnalysis', async () => {
    vi.mocked(mockClient.requestAnalysis).mockResolvedValue({
      analysis_id: 'ana-xyz',
      operation: 'analyses/ana-xyz',
    });

    await requestAdvisoryAnalysis({
      caseId: 'CASE-XYZ',
      documentRefs: [],
      lob: 'Medicaid',
      urgency: 'expedited',
    });

    expect(mockClient.requestAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ case_ref: 'CASE-XYZ' }),
    );
  });
});
