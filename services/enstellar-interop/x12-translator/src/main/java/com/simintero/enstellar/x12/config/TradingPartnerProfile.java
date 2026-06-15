package com.simintero.enstellar.x12.config;

import java.util.Map;

public record TradingPartnerProfile(String defaultLob, Map<String, String> urgencyCodeMap) {}
