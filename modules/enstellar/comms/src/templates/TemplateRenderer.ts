import Handlebars from 'handlebars';

const VKAS_URL = process.env['VKAS_URL'] ?? 'http://localhost:4040';

export interface TemplatePin {
  canonical_url: string;
  version: string;
}

export interface RenderContext {
  memberName: string;
  caseId: string;
  determinationDate?: string;
  rfiDueDate?: string;
  serviceLines?: Array<{ code: string; description: string }>;
  [key: string]: unknown;
}

export async function renderTemplate(pin: TemplatePin, context: RenderContext): Promise<string> {
  const templateContent = await resolveTemplate(pin);
  const compiled = Handlebars.compile(templateContent);
  return compiled(context);
}

async function resolveTemplate(pin: TemplatePin): Promise<string> {
  try {
    const resp = await fetch(
      `${VKAS_URL}/v1/artifacts:resolve?canonical_url=${encodeURIComponent(pin.canonical_url)}&version=${encodeURIComponent(pin.version)}`,
      {
        signal: AbortSignal.timeout(2000),
      }
    );
    if (resp.status === 501 || resp.status === 404) return defaultTemplate(pin.canonical_url);
    if (!resp.ok) throw new Error(`VKAS returned ${resp.status}`);
    const artifact = await resp.json() as { content?: { template?: string } };
    return artifact.content?.template ?? defaultTemplate(pin.canonical_url);
  } catch {
    return defaultTemplate(pin.canonical_url);
  }
}

function defaultTemplate(canonicalUrl: string): string {
  if (canonicalUrl.includes('rfi')) {
    return `Prior Authorization Request for Additional Information

Member: {{memberName}}
Case ID: {{caseId}}
RFI Due Date: {{rfiDueDate}}

Please provide the requested clinical documentation.`;
  }
  return `Prior Authorization Determination Notice

Member: {{memberName}}
Case ID: {{caseId}}
Determination Date: {{determinationDate}}

This notice confirms the prior authorization determination for the above referenced case.`;
}
