package io.simintero.tenant;

/** Request-scoped current tenant context (ThreadLocal). The filter sets it on entry
 *  and clears it in a finally block, mirroring the TS AsyncLocalStorage scoping. */
public final class TenantContextHolder {
  private static final ThreadLocal<TenantContext> CURRENT = new ThreadLocal<>();
  private TenantContextHolder() {}

  public static void set(TenantContext ctx) { CURRENT.set(ctx); }
  public static void clear() { CURRENT.remove(); }

  public static TenantContext get() {
    TenantContext ctx = CURRENT.get();
    if (ctx == null) {
      throw new IllegalStateException(
          "No tenant context: a context-requiring scope was reached without x-sim-ctx. "
        + "Ensure TenantContextFilter runs before this handler.");
    }
    return ctx;
  }
}
