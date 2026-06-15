package com.simintero.enstellar.x12;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import com.simintero.enstellar.x12.config.TradingPartnerProperties;

@SpringBootApplication
@EnableConfigurationProperties(TradingPartnerProperties.class)
public class X12TranslatorApplication {
    public static void main(String[] args) {
        SpringApplication.run(X12TranslatorApplication.class, args);
    }
}
