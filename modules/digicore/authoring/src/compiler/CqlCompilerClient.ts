export interface CompilerHttpClient {
  post(url: string, body: unknown): Promise<unknown>;
}

export interface ElmResult {
  library: {
    statements: {
      def: unknown[];
    };
    identifier: {
      id: string;
      version: string;
    };
  };
}

export class CompilationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`CQL compilation failed: ${errors.join('; ')}`);
    this.name = 'CompilationError';
    this.errors = errors;
  }
}

export class CqlCompilerClient {
  private readonly httpClient: CompilerHttpClient;
  private readonly runtimeBaseUrl: string;

  constructor(httpClient: CompilerHttpClient, runtimeBaseUrl: string) {
    this.httpClient = httpClient;
    this.runtimeBaseUrl = runtimeBaseUrl;
  }

  async compile(cqlSource: string): Promise<ElmResult> {
    const response = await this.httpClient.post(
      `${this.runtimeBaseUrl}/internal/compile`,
      { cql: cqlSource }
    );

    if (isErrorResponse(response)) {
      throw new CompilationError(response.errors);
    }

    if (!isElmResult(response)) {
      throw new CompilationError([
        'Response is malformed or missing library.statements.def array',
      ]);
    }

    return response;
  }
}

function isErrorResponse(value: unknown): value is { errors: string[] } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return 'errors' in v && Array.isArray(v['errors']);
}

function isElmResult(value: unknown): value is ElmResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;

  if (typeof v['library'] !== 'object' || v['library'] === null) return false;
  const lib = v['library'] as Record<string, unknown>;

  if (typeof lib['statements'] !== 'object' || lib['statements'] === null) return false;
  const stmts = lib['statements'] as Record<string, unknown>;
  if (!Array.isArray(stmts['def'])) return false;

  if (typeof lib['identifier'] !== 'object' || lib['identifier'] === null) return false;
  const ident = lib['identifier'] as Record<string, unknown>;
  if (typeof ident['id'] !== 'string' || typeof ident['version'] !== 'string') return false;

  return true;
}
