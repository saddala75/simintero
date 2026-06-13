export interface VsacConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ValueSet {
  oid: string;
  version: string;
  displayName: string;
  concepts: Concept[];
}

export interface Concept {
  code: string;
  codeSystem: string;
  displayName: string;
}

export interface ValueSetMetadata {
  oid: string;
  displayName: string;
  version: string;
}
