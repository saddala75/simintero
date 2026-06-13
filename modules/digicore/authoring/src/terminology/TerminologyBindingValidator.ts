export interface TerminologyHttpClient {
  get(url: string): Promise<{ status: number }>;
}

export interface ValidationResult {
  valid: boolean;
  unresolvedValueSets: string[];
}

export class TerminologyBindingValidator {
  private readonly httpClient: TerminologyHttpClient;
  private readonly terminologyGwBaseUrl: string;

  constructor(httpClient: TerminologyHttpClient, terminologyGwBaseUrl: string) {
    this.httpClient = httpClient;
    this.terminologyGwBaseUrl = terminologyGwBaseUrl;
  }

  async validate(cqlSource: string): Promise<ValidationResult> {
    const valueSetUrlRegex = /valueset\s+"[^"]+"\s*:\s*'([^']+)'/g;
    const urls: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = valueSetUrlRegex.exec(cqlSource)) !== null) {
      const url = match[1];
      if (url !== undefined) {
        urls.push(url);
      }
    }

    const unresolvedValueSets: string[] = [];

    for (const vsUrl of urls) {
      const endpoint = `${this.terminologyGwBaseUrl}/fhir/ValueSet/$validate-code?url=${encodeURIComponent(vsUrl)}`;
      const response = await this.httpClient.get(endpoint);
      if (response.status === 404) {
        unresolvedValueSets.push(vsUrl);
      }
    }

    return {
      valid: unresolvedValueSets.length === 0,
      unresolvedValueSets,
    };
  }
}
