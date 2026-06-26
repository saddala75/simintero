package com.simintero.enstellar.interop.attachments;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Connection settings for the claims service (attachment callbacks). */
@ConfigurationProperties(prefix = "enstellar.claims")
public record ClaimsConfig(
        @DefaultValue("http://localhost:3040") String baseUrl
) {}
