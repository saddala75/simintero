import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderTemplate } from '../templates/TemplateRenderer.js';

describe('TemplateRenderer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders RFI template with memberName, caseId, rfiDueDate', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 501 }));
    const result = await renderTemplate(
      { canonical_url: 'rfi-template', version: '1.0' },
      { memberName: 'John Doe', caseId: 'case-123', rfiDueDate: '2026-02-01' }
    );
    expect(result).toContain('John Doe');
    expect(result).toContain('case-123');
    expect(result).toContain('2026-02-01');
  });

  it('renders determination template with memberName, caseId, determinationDate', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 501 }));
    const result = await renderTemplate(
      { canonical_url: 'determination-letter', version: '1.0' },
      { memberName: 'Jane Smith', caseId: 'case-456', determinationDate: '2026-03-15' }
    );
    expect(result).toContain('Jane Smith');
    expect(result).toContain('case-456');
    expect(result).toContain('2026-03-15');
  });

  it('passes pin.version to VKAS resolve URL', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 501 }));
    const pin = { canonical_url: 'https://artifacts.simintero.io/t/rfi', version: '2.1.0' };
    await renderTemplate(pin, { memberName: 'Jane', caseId: 'c-456' });
    const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('version=2.1.0');
    expect(calledUrl).toContain(encodeURIComponent(pin.canonical_url));
  });

  it('falls back to default template when VKAS returns 404', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const result = await renderTemplate(
      { canonical_url: 'rfi-notice', version: '1.0' },
      { memberName: 'Alice', caseId: 'c-789', rfiDueDate: '2026-04-01' }
    );
    expect(result).toContain('Alice');
    expect(result).toContain('c-789');
  });

  it('falls back to default template when fetch throws (network error)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const result = await renderTemplate(
      { canonical_url: 'determination-letter', version: '1.0' },
      { memberName: 'Bob', caseId: 'c-999', determinationDate: '2026-05-01' }
    );
    expect(result).toContain('Bob');
    expect(result).toContain('c-999');
  });

  it('uses template content from VKAS when available', async () => {
    const customTemplate = 'Custom: {{memberName}} / {{caseId}}';
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: { template: customTemplate } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const result = await renderTemplate(
      { canonical_url: 'custom-template', version: '1.0' },
      { memberName: 'Carol', caseId: 'c-100' }
    );
    expect(result).toBe('Custom: Carol / c-100');
  });
});
