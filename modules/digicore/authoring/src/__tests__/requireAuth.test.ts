import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { requireAuth } from '../middleware/requireAuth.js';
import type { JwtVerifier } from '../middleware/requireAuth.js';

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;
let mockVerify: ReturnType<typeof vi.fn>;

function makeMockVerifier(): JwtVerifier {
  mockVerify = vi.fn();
  return { verify: mockVerify };
}

async function startServer(verifier: JwtVerifier): Promise<void> {
  const app = express();
  app.use(express.json());

  // Protected route — responds with the injected sub so we can assert on it.
  app.get('/protected', requireAuth(verifier), (req, res) => {
    res.json({ sub: (req as any).user?.sub });
  });

  await new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

async function stopServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requireAuth middleware', () => {
  beforeEach(async () => {
    if (server) await stopServer();
    const verifier = makeMockVerifier();
    await startServer(verifier);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await get('/protected');
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('SIM-AUTH-0001');
  });

  it('returns 401 when Authorization header is present but not a Bearer token', async () => {
    const res = await get('/protected', { Authorization: 'Basic dXNlcjpwYXNz' });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('SIM-AUTH-0001');
  });

  it('passes through and injects req.user.sub when the token is valid', async () => {
    mockVerify.mockResolvedValueOnce({ sub: 'user-abc-123' });

    const res = await get('/protected', { Authorization: 'Bearer valid-token' });
    expect(res.status).toBe(200);
    const body = await res.json() as { sub: string };
    expect(body.sub).toBe('user-abc-123');
    expect(mockVerify).toHaveBeenCalledWith('valid-token');
  });

  it('returns 401 when the verifier rejects (expired token)', async () => {
    mockVerify.mockRejectedValueOnce(new Error('JWTExpired'));

    const res = await get('/protected', { Authorization: 'Bearer expired-token' });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('SIM-AUTH-0002');
  });

  it('returns 401 when the verifier rejects (wrong issuer)', async () => {
    mockVerify.mockRejectedValueOnce(new Error('JWTIssuerInvalid'));

    const res = await get('/protected', { Authorization: 'Bearer wrong-issuer-token' });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('SIM-AUTH-0002');
  });

  it('strips the "Bearer " prefix before calling verify', async () => {
    mockVerify.mockResolvedValueOnce({ sub: 'user-xyz' });

    await get('/protected', { Authorization: 'Bearer the-actual-jwt' });
    expect(mockVerify).toHaveBeenCalledWith('the-actual-jwt');
    // Must NOT include the "Bearer " prefix
    expect(mockVerify).not.toHaveBeenCalledWith('Bearer the-actual-jwt');
  });
});
