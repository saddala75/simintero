package io.simintero.tenant;

import org.junit.jupiter.api.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

import java.sql.*;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

@Testcontainers
class TenantGucRlsTest {

  @Container
  static PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");

  @BeforeAll
  static void setup() throws Exception {
    try (Connection admin = DriverManager.getConnection(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword());
         Statement st = admin.createStatement()) {
      st.execute("CREATE TABLE note (tenant_id text not null, body text)");
      st.execute("ALTER TABLE note ENABLE ROW LEVEL SECURITY");
      st.execute("ALTER TABLE note FORCE ROW LEVEL SECURITY");
      st.execute("CREATE POLICY tenant_isolation ON note "
               + "USING (tenant_id = current_setting('sim.tenant_id', true))");
      st.execute("CREATE ROLE app_user LOGIN PASSWORD 'app_pw'");
      st.execute("GRANT SELECT, INSERT ON note TO app_user");
    }
  }

  private static Connection appConn() throws SQLException {
    return DriverManager.getConnection(PG.getJdbcUrl(), "app_user", "app_pw");
  }

  @Test
  void gucIsolatesTenants() throws Exception {
    try (Connection c = appConn()) {
      c.setAutoCommit(false);
      TenantConnections.setTenantGuc(c, "t_a");
      try (PreparedStatement ins = c.prepareStatement("INSERT INTO note(tenant_id, body) VALUES ('t_a','secret-a')")) {
        ins.executeUpdate();
      }
      c.commit();
    }
    try (Connection c = appConn()) {
      c.setAutoCommit(false);
      TenantConnections.setTenantGuc(c, "t_b");
      try (PreparedStatement ins = c.prepareStatement("INSERT INTO note(tenant_id, body) VALUES ('t_b','secret-b')")) {
        ins.executeUpdate();
      }
      List<String> visible = new ArrayList<>();
      try (ResultSet rs = c.createStatement().executeQuery("SELECT body FROM note ORDER BY body")) {
        while (rs.next()) visible.add(rs.getString(1));
      }
      c.commit();
      assertEquals(List.of("secret-b"), visible, "tenant_b must see only its own row");
    }
  }

  @Test
  void blankTenantRejected() throws Exception {
    try (Connection c = appConn()) {
      assertThrows(IllegalArgumentException.class, () -> TenantConnections.setTenantGuc(c, "   "));
    }
  }
}
