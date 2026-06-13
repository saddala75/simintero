package io.simintero.x12;

/**
 * Thrown when an X12 input is structurally invalid
 * (e.g., missing segment terminator {@code ~}).
 *
 * <p>Unchecked so parsers can surface problems without forcing callers to declare checked
 * exceptions; the {@code X12ExceptionHandler} @ControllerAdvice translates these to 400.
 */
public class X12ParseException extends RuntimeException {

    public X12ParseException(String message) {
        super(message);
    }

    public X12ParseException(String message, Throwable cause) {
        super(message, cause);
    }
}
