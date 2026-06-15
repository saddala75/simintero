package com.simintero.enstellar.interop.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Extracts tenant_id from the JWT principal and populates TenantContext for the
 * duration of the request. Skips if TenantContext is already set (e.g. by
 * ConformanceTestAuthFilter). Clears on exit — no ThreadLocal leaks.
 *
 * Order 10 — runs after Spring Security (FilterChainProxy, order -100).
 * ConformanceTestAuthFilter must be placed at order -200 or lower to run
 * BEFORE Spring Security's JWT validation.
 */
@Component
@Order(10)
public class TenantContextFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain)
            throws ServletException, IOException {
        try {
            if (!TenantContext.isSet()) {
                var auth = SecurityContextHolder.getContext().getAuthentication();
                if (auth != null && auth.getPrincipal() instanceof Jwt jwt) {
                    String tenantId = jwt.getClaimAsString("tenant_id");
                    if (tenantId == null || tenantId.isBlank()) {
                        response.sendError(HttpServletResponse.SC_UNAUTHORIZED,
                            "Token is missing required tenant_id claim");
                        return;  // finally still runs; clear() is a no-op here
                    }
                    TenantContext.set(tenantId);
                }
            }
            chain.doFilter(request, response);
        } finally {
            TenantContext.clear();
        }
    }
}
