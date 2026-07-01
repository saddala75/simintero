import { describe, it, expect, vi, afterEach } from 'vitest';
import { CmsCoverageClient } from '../CmsCoverageClient.js';

// Expected CMS NCD XML structure. If the real download uses different element
// names, update parseNcdXml() in CmsCoverageClient.ts to match — keep this
// sample in sync with whatever the real CMS format turns out to be.
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<NationalCoverageList>
  <NationalCoverage>
    <NCDId>150.3</NCDId>
    <Title>Total Knee Arthroplasty</Title>
    <CoverageStatus>COVERED_WITH_LIMITATIONS</CoverageStatus>
    <EffectiveDate>20140901</EffectiveDate>
    <CriteriaText>Coverage is limited to beneficiaries with...</CriteriaText>
    <CPTCodes><CPTCode>27447</CPTCode><CPTCode>27445</CPTCode></CPTCodes>
  </NationalCoverage>
  <NationalCoverage>
    <NCDId>220.1</NCDId>
    <Title>Routine Costs in Clinical Trials</Title>
    <CoverageStatus>COVERED</CoverageStatus>
    <EffectiveDate>20000901</EffectiveDate>
    <CriteriaText>Covered for qualifying clinical trials.</CriteriaText>
    <CPTCodes></CPTCodes>
  </NationalCoverage>
  <NationalCoverage>
    <NCDId>50.1</NCDId>
    <Title>Lumbar Artificial Disc</Title>
    <CoverageStatus>NOT_COVERED</CoverageStatus>
    <EffectiveDate>20070601</EffectiveDate>
    <CriteriaText>Non-covered.</CriteriaText>
    <CPTCodes><CPTCode>22857</CPTCode></CPTCodes>
  </NationalCoverage>
</NationalCoverageList>`;

afterEach(() => vi.restoreAllMocks());

describe('CmsCoverageClient.fetchNcds', () => {
  it('parses covered_with_limitations NCD with multiple procedure codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => SAMPLE_XML }));
    const ncds = await new CmsCoverageClient('https://cms.example.com/ncds').fetchNcds();
    const knee = ncds.find(n => n.ncdId === '150.3')!;
    expect(knee.coverageIndicator).toBe('covered_with_limitations');
    expect(knee.procedureCodes).toEqual(['27447', '27445']);
    expect(knee.effectiveDate).toBe('2014-09-01');
    expect(knee.title).toBe('Total Knee Arthroplasty');
  });

  it('parses covered NCD with no procedure codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => SAMPLE_XML }));
    const ncds = await new CmsCoverageClient('https://cms.example.com/ncds').fetchNcds();
    const trial = ncds.find(n => n.ncdId === '220.1')!;
    expect(trial.coverageIndicator).toBe('covered');
    expect(trial.procedureCodes).toEqual([]);
  });

  it('parses non_covered NCD', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => SAMPLE_XML }));
    const ncds = await new CmsCoverageClient('https://cms.example.com/ncds').fetchNcds();
    expect(ncds.find(n => n.ncdId === '50.1')!.coverageIndicator).toBe('non_covered');
  });

  it('throws when CMS returns non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(new CmsCoverageClient('https://cms.example.com/ncds').fetchNcds())
      .rejects.toThrow('CMS NCD download failed: 503');
  });
});
