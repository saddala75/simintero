package io.simintero.digicore.runtime.engine;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertThrows;

class StubTerminologyProviderTest {
    @Test
    void everyOperationThrowsUntilSlice12() {
        var t = new StubTerminologyProvider();
        assertThrows(UnsupportedOperationException.class, () -> t.expand(null));
        assertThrows(UnsupportedOperationException.class, () -> t.in(null, null));
        assertThrows(UnsupportedOperationException.class, () -> t.lookup(null, null));
    }
}
