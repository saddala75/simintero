package com.simintero.enstellar.interop.auth;

/**
 * Thread-local tenant context. Set by TenantContextFilter for every authenticated request.
 * Every HAPI query must call TenantContext.require() — never query without it.
 */
public final class TenantContext {
    private static final ThreadLocal<String> TENANT_ID = new ThreadLocal<>();

    private TenantContext() {}

    public static void set(String tenantId) {
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalArgumentException("tenantId must not be blank");
        }
        TENANT_ID.set(tenantId);
    }

    /** Returns the current tenant_id. Throws if not set (programming error). */
    public static String require() {
        var id = TENANT_ID.get();
        if (id == null) {
            throw new IllegalStateException(
                "TenantContext not set — all requests must pass auth and carry tenant_id"
            );
        }
        return id;
    }

    public static void clear() {
        TENANT_ID.remove();
    }

    /** Returns true if a tenant_id has been set in the current thread. */
    public static boolean isSet() {
        return TENANT_ID.get() != null;
    }
}
