import { fetch } from 'undici';

export interface PresidioEntity {
  entity_type: string;
  start: number;
  end: number;
  score: number;
}

export interface AnonymizerItem {
  entity_type: string;
  start: number;
  end: number;
}

export interface AnonymizerResult {
  text: string;
  items: AnonymizerItem[];
}

const ENTITIES = [
  'PERSON',
  'DATE_TIME',
  'US_SSN',
  'MEDICAL_LICENSE',
  'NRP',
  'PHONE_NUMBER',
  'EMAIL_ADDRESS',
  'US_PASSPORT',
  'US_DRIVER_LICENSE',
];

const ANONYMIZERS = {
  DEFAULT:          { type: 'replace', new_value: '[REDACTED]' },
  PERSON:           { type: 'replace', new_value: '[REDACTED:PERSON]' },
  DATE_TIME:        { type: 'replace', new_value: '[REDACTED:DATE]' },
  US_SSN:           { type: 'replace', new_value: '[REDACTED:SSN]' },
  MEDICAL_LICENSE:  { type: 'replace', new_value: '[REDACTED:LICENSE]' },
  PHONE_NUMBER:     { type: 'replace', new_value: '[REDACTED:PHONE]' },
  EMAIL_ADDRESS:    { type: 'replace', new_value: '[REDACTED:EMAIL]' },
  US_PASSPORT:      { type: 'replace', new_value: '[REDACTED:PASSPORT]' },
  US_DRIVER_LICENSE:{ type: 'replace', new_value: '[REDACTED:DL]' },
};

export class PresidioClient {
  constructor(
    private readonly analyzerUrl: string,
    private readonly anonymizerUrl: string,
  ) {}

  async analyze(text: string): Promise<PresidioEntity[]> {
    const res = await fetch(`${this.analyzerUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: 'en', entities: ENTITIES }),
    });
    if (!res.ok) throw new Error(`Presidio analyzer failed: HTTP ${res.status}`);
    return res.json() as Promise<PresidioEntity[]>;
  }

  async anonymize(text: string, analyzerResults: PresidioEntity[]): Promise<AnonymizerResult> {
    const res = await fetch(`${this.anonymizerUrl}/anonymize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        anonymizers: ANONYMIZERS,
        analyzer_results: analyzerResults,
      }),
    });
    if (!res.ok) throw new Error(`Presidio anonymizer failed: HTTP ${res.status}`);
    return res.json() as Promise<AnonymizerResult>;
  }
}
