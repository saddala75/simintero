package com.simintero.enstellar.interop.config;

import com.simintero.enstellar.interop.auth.ConformanceTestAuthFilter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

import java.util.List;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final String jwkSetUri;
    private final String issuerUri;
    private final String expectedAudience;

    public SecurityConfig(
            @Value("${spring.security.oauth2.resourceserver.jwt.jwk-set-uri}") String jwkSetUri,
            @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri}") String issuerUri,
            @Value("${enstellar.security.expected-audience:enstellar-api}") String expectedAudience) {
        this.jwkSetUri = jwkSetUri;
        this.issuerUri = issuerUri;
        this.expectedAudience = expectedAudience;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http,
            @Autowired(required = false) ConformanceTestAuthFilter conformanceFilter)
            throws Exception {

        // Register the conformance filter INSIDE FilterChainProxy so that its
        // SecurityContextHolder write survives Spring Security 6's SecurityContextHolderFilter.
        // The bean only exists when interop.conformance-test-mode=true (see ConformanceTestFilterConfig).
        if (conformanceFilter != null) {
            http.addFilterBefore(conformanceFilter, BearerTokenAuthenticationFilter.class);
        }

        return http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // AntPathRequestMatcher is required here because /fhir/metadata is served
                // by the HAPI RestfulServer servlet, not a Spring MVC controller — the default
                // MvcRequestMatcher would not find a handler for this path and silently skip
                // the permitAll rule, causing a 401 for every unauthenticated metadata request.
                .requestMatchers(new AntPathRequestMatcher("/fhir/metadata", HttpMethod.GET.name())).permitAll()
                .requestMatchers(new AntPathRequestMatcher("/.well-known/smart-configuration", HttpMethod.GET.name())).permitAll()
                // CDS Hooks (CRD) is unauthenticated transport: the EHR carries a SMART
                // backend token in the request body's fhirAuthorization, and the controller
                // enforces tenant presence. No determination is made here (advisory cards only).
                .requestMatchers(new AntPathRequestMatcher("/cds-services")).permitAll()
                .requestMatchers(new AntPathRequestMatcher("/cds-services/**")).permitAll()
                // DTR SMART launch is reached before the app authenticates (pilot: in-house renderer).
                .requestMatchers(new AntPathRequestMatcher("/dtr/launch", HttpMethod.GET.name())).permitAll()
                // Everything else requires a valid JWT
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                // Leave decoder wiring to Spring's auto-configuration so that tests can
                // substitute a @Primary JwtDecoder (TestSecurityConfig) without the filter
                // chain bypassing that override by calling this.jwtDecoder() directly.
                .jwt(jwt -> {})
            )
            .build();
    }

    /**
     * Production JwtDecoder: validates JWT signature (via JWK Set), issuer, and audience.
     * Tests replace this bean with @Primary TestSecurityConfig.testJwtDecoder(), which
     * uses the in-process RSA key and skips network-dependent JWK retrieval.
     */
    @Bean
    public JwtDecoder jwtDecoder() {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build();

        if (issuerUri == null || issuerUri.isBlank()) {
            throw new IllegalStateException(
                "enstellar.security.issuer-uri must not be blank; set KEYCLOAK_ISSUER_URI");
        }
        OAuth2TokenValidator<Jwt> defaults = JwtValidators.createDefaultWithIssuer(issuerUri);

        OAuth2TokenValidator<Jwt> audienceValidator = new JwtClaimValidator<List<String>>(
            JwtClaimNames.AUD,
            aud -> aud != null && aud.contains(expectedAudience)
        );

        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(defaults, audienceValidator));
        return decoder;
    }
}
