import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// ---------------------------------------------------------------------------
// Verifier abstraction — injected so tests can supply a stub
// ---------------------------------------------------------------------------

export interface JwtVerifier {
  verify(token: string): Promise<{ sub: string }>;
}

// ---------------------------------------------------------------------------
// Production verifier backed by Keycloak JWKS endpoint
// ---------------------------------------------------------------------------

export function createJwksVerifier(): JwtVerifier {
  const keycloakUrl =
    process.env['KEYCLOAK_URL'] ?? 'http://keycloak:8081';
  const jwksUri = `${keycloakUrl}/realms/simintero/protocol/openid-connect/certs`;
  const issuer = `${keycloakUrl}/realms/simintero`;

  const JWKS = createRemoteJWKSet(new URL(jwksUri));

  return {
    async verify(token: string): Promise<{ sub: string }> {
      const { payload } = await jwtVerify(token, JWKS, { issuer });
      if (typeof payload['sub'] !== 'string' || payload['sub'].length === 0) {
        throw new Error('JWT sub claim is missing or empty');
      }
      return { sub: payload['sub'] };
    },
  };
}

// ---------------------------------------------------------------------------
// Express middleware factory
// ---------------------------------------------------------------------------

export interface AuthedRequest extends Request {
  user: { sub: string };
}

export function requireAuth(
  verifier: JwtVerifier,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      res
        .status(401)
        .json({ error: 'Unauthorized', code: 'SIM-AUTH-0001' });
      return;
    }

    const token = authHeader.slice('Bearer '.length);
    try {
      const user = await verifier.verify(token);
      (req as AuthedRequest).user = user;
      next();
    } catch {
      res
        .status(401)
        .json({ error: 'Unauthorized', code: 'SIM-AUTH-0002' });
    }
  };
}
