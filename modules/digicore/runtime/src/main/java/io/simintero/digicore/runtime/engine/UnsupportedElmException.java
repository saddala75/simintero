package io.simintero.digicore.runtime.engine;

/**
 * Thrown when {@link ElmInterpreter} encounters an ELM node type (or reference) it
 * does not support. The interpreter must FAIL LOUD rather than silently coercing an
 * unknown construct to {@code false}/{@code null}.
 */
public class UnsupportedElmException extends RuntimeException {
    public UnsupportedElmException(String message) {
        super(message);
    }
}
