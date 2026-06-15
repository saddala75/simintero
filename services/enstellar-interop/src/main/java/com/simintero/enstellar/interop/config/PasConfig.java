package com.simintero.enstellar.interop.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties(prefix = "enstellar.pas")
public record PasConfig(
    String normalizationUrl,
    MinioProps minio,
    KafkaProps kafka
) {

    public record MinioProps(
        String endpoint,
        String accessKey,
        String secretKey,
        @DefaultValue("false") boolean secure,
        @DefaultValue("enstellar-raw-bundles") String bucket
    ) {}

    public record KafkaProps(
        @DefaultValue("case.intake.received") String intakeTopic
    ) {}
}
