package io.simintero.digicore.runtime.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final OtelTenantInterceptor otelTenantInterceptor;

    public WebMvcConfig(OtelTenantInterceptor otelTenantInterceptor) {
        this.otelTenantInterceptor = otelTenantInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(otelTenantInterceptor);
    }
}
