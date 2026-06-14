package io.simintero.tenant;

import jakarta.servlet.*;
import jakarta.servlet.http.*;

import java.io.IOException;

/** Reads the signed `x-sim-ctx` token, verifies it into a TenantContext, and scopes it
 *  for the request — mirroring platform/libs/tenant-context/ts/src/middleware.ts
 *  (401 codes SIM-PLAT-0001/0002/0003). Signature verification is pluggable via Verifier. */
public class TenantContextFilter implements Filter {

  @FunctionalInterface
  public interface Verifier { TenantContext verify(String token) throws Exception; }

  private static final System.Logger LOG = System.getLogger(TenantContextFilter.class.getName());

  private final Verifier verifier;

  public TenantContextFilter(Verifier verifier) { this.verifier = verifier; }

  @Override
  public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
      throws IOException, ServletException {
    HttpServletRequest req = (HttpServletRequest) request;
    HttpServletResponse res = (HttpServletResponse) response;

    String token = req.getHeader("x-sim-ctx");
    if (token == null || token.isEmpty()) {
      res.sendError(401, "SIM-PLAT-0001: x-sim-ctx header is required on all authenticated requests");
      return;
    }

    TenantContext ctx;
    try {
      ctx = verifier.verify(token);
    } catch (Exception e) {
      LOG.log(System.Logger.Level.WARNING, "x-sim-ctx verification failed", e);
      res.sendError(401, "SIM-PLAT-0003: the x-sim-ctx token could not be verified");
      return;
    }

    if (ctx == null || ctx.tenantId() == null || ctx.tenantId().isBlank()) {
      res.sendError(401, "SIM-PLAT-0002: tenant_id is required in the context token");
      return;
    }

    TenantContextHolder.set(ctx);
    try {
      chain.doFilter(request, response);
    } finally {
      TenantContextHolder.clear();
    }
  }
}
