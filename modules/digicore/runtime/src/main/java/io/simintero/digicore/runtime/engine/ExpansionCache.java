package io.simintero.digicore.runtime.engine;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Phase 1 in-memory expansion cache.
 *
 * Caches value-set expansions keyed by (valueSetUrl, version) so that repeated
 * ELM evaluations within the same JVM lifecycle do not re-fetch the same data.
 * Phase 2 will connect this to the FHIR Terminology Server; Phase 1 returns an
 * empty expansion for every key.
 */
@Component
public class ExpansionCache {

    private final Map<String, Object> store = new ConcurrentHashMap<>();

    /** Return cached expansion or null if not present. */
    public Object get(String valueSetUrl, String version) {
        return store.get(cacheKey(valueSetUrl, version));
    }

    /** Put an expansion into the cache. */
    public void put(String valueSetUrl, String version, Object expansion) {
        store.put(cacheKey(valueSetUrl, version), expansion);
    }

    /** Remove all cached entries. Useful for tests. */
    public void evictAll() {
        store.clear();
    }

    private String cacheKey(String url, String version) {
        return url + "|" + (version == null ? "" : version);
    }
}
