package io.simintero.authz;

import java.util.List;

/** The principal the OPA Rego expects under input.principal.sim. In interop these
 *  fields come from the Spring Security-validated Keycloak JWT (realm simintero). */
public record Principal(String tenantId, List<String> roles, String principalType) {}
