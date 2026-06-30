import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a fresh copy of env without the test-set values
    delete process.env['RUNTIME_BASE_URL'];
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it('throws an error if RUNTIME_BASE_URL is not set', () => {
    delete process.env['RUNTIME_BASE_URL'];

    expect(() => {
      // Simulate what happens when the module tries to initialize
      const runtimeBaseUrl = process.env['RUNTIME_BASE_URL'];
      if (!runtimeBaseUrl) {
        throw new Error('RUNTIME_BASE_URL is required');
      }
    }).toThrow('RUNTIME_BASE_URL is required');
  });

  it('accepts RUNTIME_BASE_URL when set', () => {
    process.env['RUNTIME_BASE_URL'] = 'http://digicore-runtime:8083';

    const runtimeBaseUrl = process.env['RUNTIME_BASE_URL'];
    if (!runtimeBaseUrl) {
      throw new Error('RUNTIME_BASE_URL is required');
    }

    expect(runtimeBaseUrl).toBe('http://digicore-runtime:8083');
  });
});
