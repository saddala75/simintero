package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

@Component
public class DefaultVkasClient implements VkasClient {

    @Override
    public List<String> resolveDefaultPins(String serviceCode) {
        return List.of(PinResolver.DEFAULT_PIN);
    }

    @Override
    public Optional<JsonNode> resolveContent(String canonicalUrl, String version, RuleContext ctx) {
        return Optional.empty();
    }
}
