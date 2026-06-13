const REVITAL_URL = process.env['REVITAL_URL'] ?? 'http://localhost:3050';

async function fetchAnalysis(analysisId: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${REVITAL_URL}/v1/assist/analyses/${analysisId}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function advisory(
  _caseId: string,
  analysisId: string | null,
): Promise<{ status: string; analysis_id: string | null; result: unknown | null }> {
  if (!analysisId) return { status: 'not_available', analysis_id: null, result: null };
  const result = await fetchAnalysis(analysisId);
  if (!result) return { status: 'not_available', analysis_id: analysisId, result: null };
  return { status: 'available', analysis_id: analysisId, result };
}
