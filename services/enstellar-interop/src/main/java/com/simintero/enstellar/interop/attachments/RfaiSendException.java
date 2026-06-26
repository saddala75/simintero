package com.simintero.enstellar.interop.attachments;

/** Unchecked exception thrown when the 277-RFAI POST to the clearinghouse adapter fails. */
public class RfaiSendException extends RuntimeException {
    public RfaiSendException(String message, Throwable cause) {
        super(message, cause);
    }
}
