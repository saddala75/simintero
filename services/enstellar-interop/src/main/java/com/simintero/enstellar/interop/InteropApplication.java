package com.simintero.enstellar.interop;

import com.simintero.enstellar.interop.config.PasConfig;
import com.simintero.enstellar.interop.crd.DigicoreConfig;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties({PasConfig.class, DigicoreConfig.class})
public class InteropApplication {
    public static void main(String[] args) {
        SpringApplication.run(InteropApplication.class, args);
    }
}
