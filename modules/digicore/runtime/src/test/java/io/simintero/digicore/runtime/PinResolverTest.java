package io.simintero.digicore.runtime;

import io.simintero.digicore.runtime.engine.PinResolver;
import io.simintero.digicore.runtime.engine.VkasClient;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PinResolverTest {

    private final VkasClient mockVkasClient = mock(VkasClient.class);
    private final PinResolver resolver = new PinResolver(mockVkasClient);

    @Test
    void whenCallerPinsProvided_returnThemAsIs_vkasNotCalled() {
        List<String> callerPins = List.of("urn:sim:policy:custom:2.0.0", "urn:sim:policy:custom:2.1.0");

        List<String> resolved = resolver.resolve(callerPins, "knee_arthroscopy");

        assertEquals(callerPins, resolved, "When caller provides pins, they must be returned unchanged (VKAS bypass)");
        verify(mockVkasClient, never()).resolveDefaultPins(any());
    }

    @Test
    void whenCallerPinsIsEmptyList_defaultPinReturned() {
        when(mockVkasClient.resolveDefaultPins("knee_arthroscopy"))
                .thenReturn(List.of(PinResolver.DEFAULT_PIN));

        List<String> resolved = resolver.resolve(List.of(), "knee_arthroscopy");

        assertEquals(1, resolved.size());
        assertEquals(PinResolver.DEFAULT_PIN, resolved.get(0));
        verify(mockVkasClient).resolveDefaultPins("knee_arthroscopy");
    }

    @Test
    void whenCallerPinsIsNull_defaultPinReturned() {
        when(mockVkasClient.resolveDefaultPins("knee_arthroscopy"))
                .thenReturn(List.of(PinResolver.DEFAULT_PIN));

        List<String> resolved = resolver.resolve(null, "knee_arthroscopy");

        assertEquals(1, resolved.size());
        assertEquals(PinResolver.DEFAULT_PIN, resolved.get(0));
        verify(mockVkasClient).resolveDefaultPins("knee_arthroscopy");
    }

    @Test
    void defaultPinHasExpectedUrn() {
        assertEquals("urn:sim:policy:knee-arthroscopy:1.0.0", PinResolver.DEFAULT_PIN);
    }
}
