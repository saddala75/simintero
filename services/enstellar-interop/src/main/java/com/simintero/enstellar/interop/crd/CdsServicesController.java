package com.simintero.enstellar.interop.crd;

import io.simintero.tenant.TenantContext;
import io.simintero.tenant.TenantContextHolder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Da Vinci CRD via CDS Hooks 2.0. Discovery + invoke for order-select / order-sign /
 * appointment-book. Returns advisory cards sourced from Digicore; never makes a determination.
 *
 * <p>Mounted at {@code /cds-services} (the Spring DispatcherServlet path, separate from the HAPI
 * RestfulServer at {@code /fhir/*}). Transport is unauthenticated (permitAll in SecurityConfig);
 * tenant is supplied by the caller via {@code X-Tenant-Id} for the pilot simulator. A real EHR
 * will map tenant from registration / the request's {@code fhirAuthorization} — out of scope here.
 */
@RestController
@RequestMapping("/cds-services")
public class CdsServicesController {

    private static final Logger log = LoggerFactory.getLogger(CdsServicesController.class);
    private static final List<String> HOOKS = List.of("order-select", "order-sign", "appointment-book");

    private final DigicoreClient digicore;
    private final CrdCardMapper mapper;

    public CdsServicesController(DigicoreClient digicore, CrdCardMapper mapper) {
        this.digicore = digicore;
        this.mapper = mapper;
    }

    /** CDS Hooks discovery — lists the supported services. */
    @GetMapping
    public Map<String, Object> services() {
        List<Map<String, Object>> services = HOOKS.stream().map(h -> Map.<String, Object>of(
                "hook", h,
                "id", h,
                "title", "Enstellar CRD (" + h + ")",
                "description", "Coverage requirements discovery for " + h)).toList();
        return Map.of("services", services);
    }

    /** CDS Hooks invoke — returns advisory cards. */
    @PostMapping("/{id}")
    public ResponseEntity<CdsServicesResponse> invoke(
            @PathVariable String id,
            @RequestHeader(value = "X-Tenant-Id", required = false) String tenantId,
            @RequestBody CdsHooksRequest request) {

        if (!HOOKS.contains(id)) {
            return ResponseEntity.notFound().build();
        }
        if (tenantId == null || tenantId.isBlank()) {
            return ResponseEntity.status(401).build();
        }
        try {
            TenantContextHolder.set(new TenantContext(
                tenantId, "", "pooled", TenantContext.Scopes.empty(),
                java.util.List.of(), "service"));
            Map<String, Object> ctx = request.context() == null ? Map.of() : request.context();
            String serviceCode = String.valueOf(ctx.getOrDefault("serviceCode", "unknown"));
            String memberId = String.valueOf(ctx.getOrDefault("patientId", "unknown"));
            String planId = String.valueOf(ctx.getOrDefault("planId", "unknown"));
            log.info("crd_invoke hook={} tenant={} service={}", id, tenantId, serviceCode);
            CrdContent content = digicore.getCrdContent(serviceCode, memberId, planId, tenantId);
            return ResponseEntity.ok(new CdsServicesResponse(mapper.toCards(content, serviceCode)));
        } finally {
            TenantContextHolder.clear();
        }
    }
}
