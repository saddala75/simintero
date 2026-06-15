package com.simintero.enstellar.interop.config;

import com.simintero.enstellar.interop.auth.ConformanceTestAuthFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Instantiates ConformanceTestAuthFilter as a managed Spring bean and disables its
 * automatic servlet-filter registration.  SecurityConfig then inserts the bean INSIDE
 * FilterChainProxy via addFilterBefore, which is required for the SecurityContextHolder
 * write to survive Spring Security 6's SecurityContextHolderFilter.
 *
 * Both beans are gated by interop.conformance-test-mode=true; neither exists at runtime
 * unless that property is explicitly set.  NEVER set this property in staging/production.
 */
@Configuration
public class ConformanceTestFilterConfig {

    @Bean
    @ConditionalOnProperty(name = "interop.conformance-test-mode", havingValue = "true")
    public ConformanceTestAuthFilter conformanceTestAuthFilter(
            @Value("${interop.conformance-test-token:conformance-test-token}") String token) {
        return new ConformanceTestAuthFilter(token);
    }

    /**
     * Prevents Spring Boot from registering ConformanceTestAuthFilter as a servlet filter
     * automatically.  Without this, the filter would run twice: once as a servlet filter
     * and once inside FilterChainProxy (where SecurityConfig places it).
     */
    @Bean
    @ConditionalOnProperty(name = "interop.conformance-test-mode", havingValue = "true")
    public FilterRegistrationBean<ConformanceTestAuthFilter> conformanceTestFilterRegistration(
            ConformanceTestAuthFilter filter) {
        FilterRegistrationBean<ConformanceTestAuthFilter> registration =
                new FilterRegistrationBean<>(filter);
        registration.setEnabled(false); // Spring Security's FilterChainProxy handles invocation
        return registration;
    }
}
