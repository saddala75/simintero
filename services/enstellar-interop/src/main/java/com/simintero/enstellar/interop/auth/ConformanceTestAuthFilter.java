package com.simintero.enstellar.interop.auth;

import io.simintero.tenant.TenantContext;
import io.simintero.tenant.TenantContextHolder;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

/**
 * Conformance-test-only auth bypass. Active ONLY when interop.conformance-test-mode=true.
 * Accepts a single static bearer token and sets a fixed "conformance-test" tenant.
 *
 * NEVER enable this in staging or production. The @ConditionalOnProperty guard ensures
 * this bean does not exist unless the property is explicitly set to true.
 *
 * Registered INSIDE FilterChainProxy via SecurityConfig.filterChain so that the
 * SecurityContextHolder write persists through Spring Security 6's SecurityContextHolderFilter.
 * ConformanceTestFilterConfig creates the @Bean and disables servlet-filter auto-registration
 * to prevent the filter from running twice.
 *
 * Implementation note: after accepting the conformance token, the request is wrapped to
 * strip the Authorization header from the view seen by downstream filters. This prevents
 * BearerTokenAuthenticationFilter from finding the Bearer token and attempting — and
 * failing — JWT validation on the static string.
 */
@ConditionalOnProperty(name = "interop.conformance-test-mode", havingValue = "true")
public class ConformanceTestAuthFilter extends OncePerRequestFilter {

    static final String CONFORMANCE_TENANT = "conformance-test";

    private final String expectedToken;

    public ConformanceTestAuthFilter(String token) {
        this.expectedToken = token;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain)
            throws ServletException, IOException {
        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);
            if (expectedToken.equals(token)) {
                TenantContextHolder.set(new TenantContext(
                    CONFORMANCE_TENANT, "", "pooled", TenantContext.Scopes.empty(),
                    java.util.List.of(), "service"));
                // Populate SecurityContext so Spring Security's authorization checks pass.
                // 3-arg constructor sets authenticated=true; empty authorities satisfies
                // .anyRequest().authenticated() without requiring specific roles.
                var authToken = new UsernamePasswordAuthenticationToken(
                    CONFORMANCE_TENANT, null, List.of());
                SecurityContextHolder.getContext().setAuthentication(authToken);
                // Strip the Authorization header from the wrapped request so that
                // BearerTokenAuthenticationFilter finds no Bearer token and skips JWT
                // validation entirely.
                try {
                    chain.doFilter(new StripAuthorizationHeaderWrapper(request), response);
                } finally {
                    TenantContextHolder.clear();
                    SecurityContextHolder.clearContext();
                }
                return;
            }
        }
        // Token absent or wrong — fall through to normal Spring Security JWT validation
        chain.doFilter(request, response);
    }

    /**
     * Hides the Authorization header from all downstream filters after the conformance
     * token has been accepted. BearerTokenAuthenticationFilter resolves the token via
     * {@code request.getHeader("Authorization")} and will skip processing if null.
     */
    private static final class StripAuthorizationHeaderWrapper extends HttpServletRequestWrapper {

        StripAuthorizationHeaderWrapper(HttpServletRequest request) {
            super(request);
        }

        @Override
        public String getHeader(String name) {
            if ("Authorization".equalsIgnoreCase(name)) {
                return null;
            }
            return super.getHeader(name);
        }

        @Override
        public Enumeration<String> getHeaders(String name) {
            if ("Authorization".equalsIgnoreCase(name)) {
                return Collections.emptyEnumeration();
            }
            return super.getHeaders(name);
        }

        @Override
        public Enumeration<String> getHeaderNames() {
            List<String> names = Collections.list(super.getHeaderNames());
            names.removeIf("Authorization"::equalsIgnoreCase);
            return Collections.enumeration(names);
        }
    }
}
