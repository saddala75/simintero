package io.simintero.digicore.runtime.engine;

import java.util.List;

public interface VkasClient {
    List<String> resolveDefaultPins(String serviceCode);
}
