import { describe, it, expect, vi } from 'vitest';
import {
  CqlCompilerClient,
  CompilationError,
} from '../compiler/CqlCompilerClient.js';
import type { CompilerHttpClient } from '../compiler/CqlCompilerClient.js';

const SAMPLE_CQL = "library TestLibrary version '1.0.0'";

const VALID_ELM_RESPONSE = {
  library: {
    statements: {
      def: [{ name: 'TestDefinition', context: 'Patient', type: 'ExpressionDef' }],
    },
    identifier: {
      id: 'TestLibrary',
      version: '1.0.0',
    },
  },
};

describe('CqlCompilerClient', () => {
  it('valid CQL source compiles to ELM JSON with library.statements.def array', async () => {
    const mockHttpClient: CompilerHttpClient = {
      post: vi.fn().mockResolvedValue(VALID_ELM_RESPONSE),
    };

    const client = new CqlCompilerClient(mockHttpClient, 'http://runtime:3020');
    const result = await client.compile(SAMPLE_CQL);

    expect(result.library.statements.def).toBeInstanceOf(Array);
    expect(result.library.statements.def).toHaveLength(1);
    expect(result.library.identifier.id).toBe('TestLibrary');
    expect(result.library.identifier.version).toBe('1.0.0');

    expect(mockHttpClient.post).toHaveBeenCalledWith(
      'http://runtime:3020/internal/compile',
      { cql: SAMPLE_CQL }
    );
  });

  it('error response (mock returns errors array) throws CompilationError', async () => {
    const mockHttpClient: CompilerHttpClient = {
      post: vi.fn().mockResolvedValue({ errors: ['Unknown identifier'] }),
    };

    const client = new CqlCompilerClient(mockHttpClient, 'http://runtime:3020');

    await expect(client.compile('invalid cql')).rejects.toThrow(CompilationError);

    // Verify the errors array is populated
    await expect(client.compile('invalid cql')).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CompilationError &&
        err.errors.includes('Unknown identifier')
    );
  });

  it('malformed response (no library) throws CompilationError', async () => {
    const mockHttpClient: CompilerHttpClient = {
      post: vi.fn().mockResolvedValue({ unexpected: 'shape' }),
    };

    const client = new CqlCompilerClient(mockHttpClient, 'http://runtime:3020');

    await expect(client.compile(SAMPLE_CQL)).rejects.toThrow(CompilationError);
  });
});
