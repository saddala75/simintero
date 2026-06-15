package com.simintero.enstellar.interop.crd;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Connection settings for the Digicore CRD/Questionnaire content service. */
@ConfigurationProperties(prefix = "enstellar.digicore")
public record DigicoreConfig(String baseUrl) {}
