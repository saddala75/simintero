package io.simintero.x12;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Simintero X12 Translator — bidirectional EDI X12 278/275 ↔ canonical model adapter.
 *
 * <p>Wire-format (X12) types are confined to this module ({@code integration/x12-translator}).
 * Downstream services interact only with the canonical IntakeCommand / DocumentReference.
 */
@SpringBootApplication
public class X12TranslatorApplication {

    public static void main(String[] args) {
        SpringApplication.run(X12TranslatorApplication.class, args);
    }
}
