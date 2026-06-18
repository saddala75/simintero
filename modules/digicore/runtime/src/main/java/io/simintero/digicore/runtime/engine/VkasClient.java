package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;
import java.util.Optional;

public interface VkasClient {
    List<String> resolveDefaultPins(String serviceCode);

    /** Resolve an artifact's content by canonical_url (+ optional version + context).
     *  Empty when not found (404) or VKAS is unreachable — callers must degrade, never crash. */
    Optional<JsonNode> resolveContent(String canonicalUrl, String version, RuleContext ctx);
}
