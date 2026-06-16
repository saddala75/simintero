package com.simintero.enstellar.interop.document;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Connection settings for the platform Document Service. */
@ConfigurationProperties(prefix = "enstellar.document-service")
public record DocumentServiceConfig(String baseUrl) {}
