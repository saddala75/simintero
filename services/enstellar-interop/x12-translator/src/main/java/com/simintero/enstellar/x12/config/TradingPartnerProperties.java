package com.simintero.enstellar.x12.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import java.util.Map;

@ConfigurationProperties(prefix = "x12")
public record TradingPartnerProperties(Map<String, TradingPartnerProfile> tradingPartners) {
    public TradingPartnerProfile getProfile(String id) {
        TradingPartnerProfile p = tradingPartners.get(id);
        if (p == null) throw new IllegalArgumentException("Unknown trading partner: " + id);
        return p;
    }
}
