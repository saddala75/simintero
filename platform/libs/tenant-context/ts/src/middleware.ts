import type { Request, Response, NextFunction } from "express";
import { withTenantContext } from "./index.js";
import type { TenantContext } from "./index.js";

interface MiddlewareOptions {
  verify: (token: string) => Promise<TenantContext>;
}

export function createContextMiddleware(options: MiddlewareOptions) {
  return function tenantContextMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void | Promise<void> {
    const header = req.headers["x-sim-ctx"];
    if (!header || typeof header !== "string") {
      res.status(401).json({
        code: "SIM-PLAT-0001",
        title: "Missing tenant context",
        detail: "x-sim-ctx header is required on all authenticated requests",
      });
      return;
    }

    return options
      .verify(header)
      .then((tenantCtx) => {
        if (!tenantCtx.tenant_id) {
          res.status(401).json({
            code: "SIM-PLAT-0002",
            title: "Invalid context claims",
            detail: "tenant_id is required in the context token",
          });
          return;
        }
        return withTenantContext(tenantCtx, () => {
          next();
          return Promise.resolve();
        });
      })
      .catch(() => {
        res.status(401).json({
          code: "SIM-PLAT-0003",
          title: "Context verification failed",
          detail: "The x-sim-ctx token could not be verified",
        });
      });
  };
}
