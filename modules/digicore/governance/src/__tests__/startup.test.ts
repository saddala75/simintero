import { describe, it, expect, vi } from 'vitest';
import { validateGovernanceDbUrl } from '../index.js';

describe('validateGovernanceDbUrl', () => {
  it('should return the URL when GOVERNANCE_DB_URL is provided', () => {
    const dbUrl = 'postgres://user:pass@localhost:5432/db';
    const result = validateGovernanceDbUrl(dbUrl);
    expect(result).toBe(dbUrl);
  });

  it('should fail fast with process.exit(1) when GOVERNANCE_DB_URL is missing', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error');
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit(1)');
    });

    expect(() => {
      validateGovernanceDbUrl(undefined);
    }).toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'FATAL: GOVERNANCE_DB_URL is required. Refusing to start with in-memory fallback.'
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);

    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should fail fast when GOVERNANCE_DB_URL is an empty string', () => {
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit(1)');
    });

    expect(() => {
      validateGovernanceDbUrl('');
    }).toThrow('process.exit(1)');

    expect(processExitSpy).toHaveBeenCalledWith(1);
    processExitSpy.mockRestore();
  });
});
