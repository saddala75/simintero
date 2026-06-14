package io.simintero.tenant;

import java.util.List;

/** Mirrors the TS TenantContext (platform/libs/tenant-context/ts/src/index.ts). */
public record TenantContext(
    String tenantId,
    String cellId,
    String tier,                 // pooled | dedicated | enclave
    Scopes scopes,
    List<String> roles,
    String principalType         // human | service | model_agent
) {
  public record Scopes(List<String> lob, List<String> region, List<String> modules) {
    public static Scopes empty() { return new Scopes(List.of(), List.of(), List.of()); }
  }
}
