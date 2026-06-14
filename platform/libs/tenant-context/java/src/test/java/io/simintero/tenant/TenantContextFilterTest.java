package io.simintero.tenant;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TenantContextFilterTest {

  private static TenantContext ctx(String tid) {
    return new TenantContext(tid, "cell-1", "pooled", TenantContext.Scopes.empty(), List.of(), "service");
  }

  @Test
  void missingHeaderIs401SimPlat0001() throws Exception {
    var req = mock(HttpServletRequest.class);
    var res = mock(HttpServletResponse.class);
    var chain = mock(FilterChain.class);
    when(req.getHeader("x-sim-ctx")).thenReturn(null);
    new TenantContextFilter(token -> ctx("t_acme")).doFilter(req, res, chain);
    verify(res).sendError(eq(401), contains("SIM-PLAT-0001"));
    verify(chain, never()).doFilter(any(), any());
  }

  @Test
  void verifyFailureIs401SimPlat0003() throws Exception {
    var req = mock(HttpServletRequest.class);
    var res = mock(HttpServletResponse.class);
    var chain = mock(FilterChain.class);
    when(req.getHeader("x-sim-ctx")).thenReturn("bad-token");
    new TenantContextFilter(token -> { throw new IllegalArgumentException("nope"); }).doFilter(req, res, chain);
    verify(res).sendError(eq(401), contains("SIM-PLAT-0003"));
    verify(chain, never()).doFilter(any(), any());
  }

  @Test
  void blankTenantIs401SimPlat0002() throws Exception {
    var req = mock(HttpServletRequest.class);
    var res = mock(HttpServletResponse.class);
    var chain = mock(FilterChain.class);
    when(req.getHeader("x-sim-ctx")).thenReturn("token");
    new TenantContextFilter(token -> ctx("   ")).doFilter(req, res, chain);
    verify(res).sendError(eq(401), contains("SIM-PLAT-0002"));
    verify(chain, never()).doFilter(any(), any());
  }

  @Test
  void validTokenSetsContextAndProceedsThenClears() throws Exception {
    var req = mock(HttpServletRequest.class);
    var res = mock(HttpServletResponse.class);
    when(req.getHeader("x-sim-ctx")).thenReturn("token");
    final String[] seen = new String[1];
    FilterChain chain = (rq, rs) -> seen[0] = TenantContextHolder.get().tenantId();
    new TenantContextFilter(token -> ctx("t_acme")).doFilter(req, res, chain);
    assertEquals("t_acme", seen[0]);
    assertThrows(IllegalStateException.class, TenantContextHolder::get);
  }
}
