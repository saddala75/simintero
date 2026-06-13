package io.simintero.digicore.runtime.engine;

import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class DefaultVkasClient implements VkasClient {

    @Override
    public List<String> resolveDefaultPins(String serviceCode) {
        return List.of(PinResolver.DEFAULT_PIN);
    }
}
