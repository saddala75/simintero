package io.simintero.digicore.runtime.engine;

import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Phase 1 PinResolver.
 *
 * Determinism contract: when the caller supplies pins they are returned as-is and
 * VKAS is never contacted. When the caller omits pins, the VkasClient resolves defaults.
 */
@Component
public class PinResolver {

    public static final String DEFAULT_PIN = "urn:sim:policy:knee-arthroscopy:1.0.0";

    private final VkasClient vkasClient;

    public PinResolver(VkasClient vkasClient) {
        this.vkasClient = vkasClient;
    }

    public List<String> resolve(List<String> callerPins, String serviceCode) {
        if (callerPins != null && !callerPins.isEmpty()) {
            return List.copyOf(callerPins);
        }
        return vkasClient.resolveDefaultPins(serviceCode);
    }
}
