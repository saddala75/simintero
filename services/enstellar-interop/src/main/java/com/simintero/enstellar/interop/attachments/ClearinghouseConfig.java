package com.simintero.enstellar.interop.attachments;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Connection settings for the clearinghouse adapter (277-RFAI / 275 inbound). */
@ConfigurationProperties(prefix = "enstellar.clearinghouse")
public record ClearinghouseConfig(
        @DefaultValue("http://localhost:3060") String baseUrl
) {}
