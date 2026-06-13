package io.simintero.x12.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.Map;

/**
 * Global exception handler for X12 translation errors.
 * Converts any uncaught exception from controller endpoints into a
 * structured 400 JSON error response.
 *
 * <p>PHI policy: only exception type and message are included — never raw X12 content.
 */
@ControllerAdvice
public class X12ExceptionHandler {

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleAll(Exception ex) {
        return ResponseEntity.badRequest().body(Map.of(
                "error", ex.getClass().getSimpleName(),
                "message", ex.getMessage() != null ? ex.getMessage() : "parse error"
        ));
    }
}
