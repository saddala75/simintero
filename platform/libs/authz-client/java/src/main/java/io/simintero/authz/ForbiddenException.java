package io.simintero.authz;

public class ForbiddenException extends RuntimeException {
  public static final String CODE = "SIM-AUTHZ-0001";
  public final int status = 403;
  public ForbiddenException() { super("Forbidden"); }
  public String code() { return CODE; }
}
