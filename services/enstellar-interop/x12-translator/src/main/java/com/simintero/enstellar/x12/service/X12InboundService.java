package com.simintero.enstellar.x12.service;

import com.simintero.enstellar.canonical.Case;
import com.simintero.enstellar.x12.config.TradingPartnerProperties;
import com.simintero.enstellar.x12.mapper.X12ToCanonicalMapper;
import com.simintero.enstellar.x12.parser.X12Parser;
import com.simintero.enstellar.x12.storage.X12MinioStore;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Orchestrates raw X12 278 intake: store-first, then parse and map to canonical.
 *
 * Store-first pattern: raw bytes are durably written to MinIO before any
 * transformation so that the original interchange is always recoverable.
 */
@Service
public class X12InboundService {

    private final X12MinioStore store;
    private final X12ToCanonicalMapper mapper;
    private final TradingPartnerProperties properties;

    public X12InboundService(X12MinioStore store,
                             X12ToCanonicalMapper mapper,
                             TradingPartnerProperties properties) {
        this.store = store;
        this.mapper = mapper;
        this.properties = properties;
    }

    public record CanonicalResult(String correlationId, Case canonicalCase) {}

    /**
     * Parse, durably store, and map a raw X12 278 interchange.
     *
     * @param rawX12          the raw EDI text
     * @param tenantId        tenant scope for all generated IDs and PHI boundary
     * @param tradingPartnerId key into {@link TradingPartnerProperties} configuration
     * @return the generated correlation ID and the mapped canonical Case
     */
    public CanonicalResult parseAndStore(String rawX12,
                                         String tenantId,
                                         String tradingPartnerId) {
        String storageKey = UUID.randomUUID().toString();
        // Store raw X12 before any transformation (durable, auditable receipt)
        store.store(rawX12, tenantId, storageKey);

        var tx = new X12Parser().parse(rawX12);
        var profile = properties.getProfile(tradingPartnerId);
        Case canonicalCase = mapper.map(tx, tenantId, profile);

        // Return the trading-partner correlationId from BHT03, not the internal storage key
        return new CanonicalResult(canonicalCase.correlationId(), canonicalCase);
    }
}
