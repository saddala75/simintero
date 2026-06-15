package com.simintero.enstellar.interop.auth;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TenantContextTest {

    @AfterEach
    void cleanup() { TenantContext.clear(); }

    @Test
    void isSet_false_when_empty() {
        assertThat(TenantContext.isSet()).isFalse();
    }

    @Test
    void isSet_true_after_set() {
        TenantContext.set("acme");
        assertThat(TenantContext.isSet()).isTrue();
    }

    @Test
    void isSet_false_after_clear() {
        TenantContext.set("acme");
        TenantContext.clear();
        assertThat(TenantContext.isSet()).isFalse();
    }

    @Test
    void require_throws_when_not_set() {
        assertThatThrownBy(TenantContext::require)
            .isInstanceOf(IllegalStateException.class);
    }
}
