package com.simintero.enstellar.x12.service;

import com.simintero.enstellar.canonical.Case;
import com.simintero.enstellar.x12.config.TradingPartnerProperties;
import com.simintero.enstellar.x12.mapper.CanonicalToX12Mapper;
import org.springframework.stereotype.Service;

/**
 * Converts a canonical {@link Case} to a raw X12 278 interchange for a given trading partner.
 */
@Service
public class X12OutboundService {

    private final CanonicalToX12Mapper mapper;
    private final TradingPartnerProperties properties;

    public X12OutboundService(CanonicalToX12Mapper mapper, TradingPartnerProperties properties) {
        this.mapper = mapper;
        this.properties = properties;
    }

    public String caseToX12(Case c, String tradingPartnerId) {
        return mapper.map(c, properties.getProfile(tradingPartnerId));
    }
}
