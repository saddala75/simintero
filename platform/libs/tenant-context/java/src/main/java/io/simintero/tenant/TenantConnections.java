package io.simintero.tenant;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

/** Sets the transaction-local RLS GUC, mirroring platform/libs/tenant-context/ts/src/db.ts
 *  (`set_config('sim.tenant_id', ?, true)`). The caller owns the transaction. */
public final class TenantConnections {
  private TenantConnections() {}

  public static void setTenantGuc(Connection conn, String tenantId) throws SQLException {
    if (tenantId == null || tenantId.isBlank()) {
      throw new IllegalArgumentException("tenant_id must not be blank");
    }
    try (PreparedStatement ps = conn.prepareStatement("SELECT set_config('sim.tenant_id', ?, true)")) {
      ps.setString(1, tenantId);
      ps.execute();
    }
  }
}
