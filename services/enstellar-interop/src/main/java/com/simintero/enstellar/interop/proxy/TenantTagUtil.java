package com.simintero.enstellar.interop.proxy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;

/**
 * Pure utility: inject and verify the Enstellar tenant security tag on FHIR resources.
 * Tag shape: { "system": TENANT_SYSTEM, "code": tenantId }
 */
public final class TenantTagUtil {

    public static final String TENANT_SYSTEM = "https://enstellar.simintero.com/tenants";
    private static final ObjectMapper JSON = new ObjectMapper();

    private TenantTagUtil() {}

    /**
     * Parses {@code body} as a FHIR resource JSON object and injects a tenant security tag
     * into {@code meta.security}. Idempotent — does not duplicate an existing tag.
     */
    public static byte[] injectTenantTag(byte[] body, String tenantId) throws IOException {
        ObjectNode root = (ObjectNode) JSON.readTree(body);
        ObjectNode meta = root.has("meta")
            ? (ObjectNode) root.get("meta")
            : root.putObject("meta");
        ArrayNode security = meta.has("security")
            ? (ArrayNode) meta.get("security")
            : meta.putArray("security");

        for (var tag : security) {
            if (TENANT_SYSTEM.equals(tag.path("system").asText())
                    && tenantId.equals(tag.path("code").asText())) {
                return JSON.writeValueAsBytes(root); // already tagged
            }
        }

        security.addObject()
            .put("system", TENANT_SYSTEM)
            .put("code", tenantId);

        return JSON.writeValueAsBytes(root);
    }

    /**
     * Returns true if {@code body} contains a tenant security tag for {@code tenantId}.
     */
    public static boolean hasTenantTag(byte[] body, String tenantId) throws IOException {
        var root = JSON.readTree(body);
        var security = root.path("meta").path("security");
        if (!security.isArray()) return false;
        for (var tag : security) {
            if (TENANT_SYSTEM.equals(tag.path("system").asText())
                    && tenantId.equals(tag.path("code").asText())) {
                return true;
            }
        }
        return false;
    }
}
