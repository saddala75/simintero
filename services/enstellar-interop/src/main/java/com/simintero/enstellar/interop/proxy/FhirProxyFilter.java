package com.simintero.enstellar.interop.proxy;

import com.simintero.enstellar.interop.config.HapiProperties;
import io.simintero.tenant.TenantContextHolder;
import jakarta.annotation.PreDestroy;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.hc.client5.http.classic.methods.*;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.core5.http.ClassicHttpResponse;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.io.entity.ByteArrayEntity;
import org.apache.hc.client5.http.classic.methods.HttpUriRequestBase;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.Set;

/**
 * Core FHIR proxy filter. Forwards all /fhir/** requests to the external HAPI container,
 * enforcing tenant isolation via FHIR meta.security tags.
 *
 * <p>Only active when {@code interop.hapi.proxy-enabled=true}. This allows the embedded
 * HAPI RestfulServer to continue serving requests in local/test environments that do not
 * have an external HAPI JPA container running.
 *
 * <p>Always bypassed for {@code $submit} and {@code $inquire} (handled by the embedded
 * HAPI operation providers regardless of proxy mode).
 *
 * <p>Order 20 — after TenantContextFilter (10) and Spring Security (−100).
 */
@Component
@Order(20)
public class FhirProxyFilter extends OncePerRequestFilter {

    private static final Set<String> HOP_BY_HOP = Set.of(
        "connection", "transfer-encoding", "keep-alive",
        "proxy-authenticate", "proxy-authorization", "te", "trailers", "upgrade",
        "host",
        // HC5 computes Content-Length from the entity; forwarding the original value
        // causes a ProtocolException ("Content-Length header already present").
        "content-length",
        // Accept is stripped so we can unconditionally force application/fhir+json
        // toward HAPI, ensuring the ownership check always receives a JSON body.
        "accept"
    );

    private final HapiProperties props;
    private final String hapiBaseUrl;
    private final CloseableHttpClient httpClient;
    private final CapabilityStatementAugmenter csAugmenter;

    public FhirProxyFilter(HapiProperties props, CapabilityStatementAugmenter csAugmenter) {
        this.props = props;
        this.hapiBaseUrl = props.getBaseUrl();
        this.httpClient = HttpClients.createDefault();
        this.csAugmenter = csAugmenter;
    }

    /**
     * Returns true (filter skipped) when:
     * <ul>
     *   <li>proxy mode is disabled ({@code interop.hapi.proxy-enabled=false})</li>
     *   <li>the request targets a HAPI-local operation: {@code /$submit} or {@code /$inquire}</li>
     * </ul>
     */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!props.isProxyEnabled()) return true;
        String uri = request.getRequestURI();
        // Only the FHIR REST surface is proxied. Non-/fhir paths (e.g. /cds-services, /dtr/launch)
        // are handled by Spring MVC controllers and must not be intercepted. Anchor the prefix so
        // a path like "/fhirbogus" is not mistaken for the FHIR surface.
        if (!uri.equals("/fhir") && !uri.startsWith("/fhir/")) return true;
        // DTR Questionnaire + QuestionnaireResponse are served by embedded providers (content from
        // Digicore; responses feed PAS) — they must NOT be proxied to the external HAPI store.
        return uri.endsWith("/$submit") || uri.endsWith("/$inquire")
                || uri.startsWith("/fhir/Questionnaire");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain)
            throws ServletException, IOException {

        String path = request.getRequestURI().replaceFirst("^/fhir", "");
        boolean isMetadata = "/metadata".equals(path);
        boolean isReadById = !isMetadata && path.matches("/[A-Z][a-zA-Z]+/[^/$]+");
        boolean isSearch   = !isMetadata && !isReadById
                             && path.matches("/[A-Z][a-zA-Z]+(/.*)?");
        String method = request.getMethod();

        // Reject XML write bodies early — TenantTagUtil operates on JSON only.
        if (Set.of("POST", "PUT", "PATCH").contains(method.toUpperCase())) {
            String ct = request.getContentType();
            if (ct != null && !ct.contains("json")) {
                response.sendError(HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE,
                    "This proxy accepts JSON FHIR resources only (application/fhir+json)");
                return;
            }
        }

        // Tenant context is required for all requests except unauthenticated /metadata.
        String tenantId = isMetadata ? null : TenantContextHolder.get().tenantId();

        // Append _security query param for GET searches only (not POST creates).
        String qs = request.getQueryString();
        if (tenantId != null && isSearch && "GET".equals(method)) {
            String securityParam = "_security=" + URLEncoder.encode(
                TenantTagUtil.TENANT_SYSTEM + "|" + tenantId, StandardCharsets.UTF_8);
            qs = (qs == null || qs.isBlank()) ? securityParam : qs + "&" + securityParam;
        }
        String targetUrl = hapiBaseUrl + path + (qs != null ? "?" + qs : "");

        HttpUriRequestBase hapiRequest = buildRequest(method, targetUrl, request, tenantId);

        try (ClassicHttpResponse hapiResponse = httpClient.execute(hapiRequest)) {
            byte[] responseBody = hapiResponse.getEntity() != null
                ? hapiResponse.getEntity().getContent().readAllBytes()
                : new byte[0];

            // Augment capability statement before relaying — adds publisher, implementationGuide,
            // and Da Vinci resource entries (Claim/$submit/$inquire, ClaimResponse, Questionnaire, QR).
            if (isMetadata && hapiResponse.getCode() == 200 && responseBody.length > 0) {
                try {
                    responseBody = csAugmenter.augment(responseBody);
                } catch (IOException e) {
                    logger.warn("Failed to augment CapabilityStatement; returning upstream response unmodified", e);
                }
            }

            // Enforce tenant ownership on direct reads (GET /fhir/ResourceType/{id}).
            // Accept is forced to application/fhir+json above, so the body is always JSON.
            if (tenantId != null && "GET".equals(method) && isReadById
                    && hapiResponse.getCode() == 200) {
                if (!TenantTagUtil.hasTenantTag(responseBody, tenantId)) {
                    response.sendError(HttpStatus.FORBIDDEN.value(),
                        "Resource belongs to a different tenant");
                    return;
                }
            }

            // Relay the upstream response back to the caller.
            response.setStatus(hapiResponse.getCode());
            for (var header : hapiResponse.getHeaders()) {
                if (!HOP_BY_HOP.contains(header.getName().toLowerCase())) {
                    response.addHeader(header.getName(), header.getValue());
                }
            }
            if (responseBody.length > 0) {
                response.getOutputStream().write(responseBody); // nosemgrep: java.lang.security.audit.xss.no-direct-response-writer.no-direct-response-writer  // false positive — responseBody is the byte[] from the trusted internal HAPI FHIR backend; not user-controlled input
            }
        }
    }

    private HttpUriRequestBase buildRequest(String method, String targetUrl,
                                               HttpServletRequest request,
                                               String tenantId) throws IOException, ServletException {
        HttpUriRequestBase hapiRequest = switch (method.toUpperCase()) {
            case "GET"    -> new HttpGet(targetUrl);
            case "DELETE" -> new HttpDelete(targetUrl);
            case "POST"   -> {
                var req = new HttpPost(targetUrl);
                byte[] body = request.getInputStream().readAllBytes();
                byte[] taggedBody = (body.length > 0 && tenantId != null)
                    ? TenantTagUtil.injectTenantTag(body, tenantId) : body;
                String ct = request.getContentType() != null
                    ? request.getContentType() : "application/fhir+json";
                req.setEntity(new ByteArrayEntity(taggedBody, ContentType.parse(ct)));
                yield req;
            }
            case "PUT"    -> {
                var req = new HttpPut(targetUrl);
                byte[] body = request.getInputStream().readAllBytes();
                byte[] taggedBody = (body.length > 0 && tenantId != null)
                    ? TenantTagUtil.injectTenantTag(body, tenantId) : body;
                String ct = request.getContentType() != null
                    ? request.getContentType() : "application/fhir+json";
                req.setEntity(new ByteArrayEntity(taggedBody, ContentType.parse(ct)));
                yield req;
            }
            case "PATCH"  -> {
                var req = new HttpPatch(targetUrl);
                byte[] body = request.getInputStream().readAllBytes();
                byte[] taggedBody = (body.length > 0 && tenantId != null)
                    ? TenantTagUtil.injectTenantTag(body, tenantId) : body;
                String ct = request.getContentType() != null
                    ? request.getContentType() : "application/fhir+json";
                req.setEntity(new ByteArrayEntity(taggedBody, ContentType.parse(ct)));
                yield req;
            }
            default -> throw new ServletException("Unsupported HTTP method: " + method);
        };

        // Copy request headers; strip hop-by-hop and Authorization (not forwarded upstream).
        Enumeration<String> headerNames = request.getHeaderNames();
        while (headerNames.hasMoreElements()) {
            String name = headerNames.nextElement();
            if (!HOP_BY_HOP.contains(name.toLowerCase())
                    && !"authorization".equalsIgnoreCase(name)) {
                hapiRequest.addHeader(name, request.getHeader(name));
            }
        }
        // Always request JSON from HAPI so the tenant-ownership check can parse the body.
        // "accept" is in HOP_BY_HOP so the client's value was already stripped above.
        hapiRequest.setHeader("Accept", "application/fhir+json");

        return hapiRequest;
    }

    @PreDestroy
    public void closeHttpClient() {
        try {
            httpClient.close();
        } catch (IOException e) {
            logger.warn("Error closing FHIR proxy HTTP client", e);
        }
    }
}
