package com.simintero.enstellar.interop.crd;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CrdCardMapperTest {

    private final CrdCardMapper mapper = new CrdCardMapper();

    @Test
    void pa_required_yields_dtr_launch_card_and_docs_card() {
        var content = new CrdContent(true, List.of("clinical-notes", "diagnosis-codes"),
                "mock-rule-stub-v1", "http://localhost:8080/dtr/launch");

        List<Card> cards = mapper.toCards(content, "svc-123");

        assertThat(cards).anySatisfy(c -> {
            assertThat(c.summary()).containsIgnoringCase("prior auth");
            assertThat(c.links()).anySatisfy(l -> {
                assertThat(l.type()).isEqualTo("smart");
                assertThat(l.url()).isEqualTo("http://localhost:8080/dtr/launch");
            });
        });
        assertThat(cards).anySatisfy(c -> assertThat(c.detail()).contains("clinical-notes"));
        assertThat(cards).anySatisfy(c -> assertThat(c.source().url()).contains("mock-rule-stub-v1"));
    }

    @Test
    void pa_not_required_yields_info_card_with_rule_ref_no_launch() {
        var content = new CrdContent(false, List.of(), "rule-not-required-7", null);

        List<Card> cards = mapper.toCards(content, "svc-9");

        assertThat(cards).hasSize(1);
        assertThat(cards.get(0).summary()).containsIgnoringCase("not required");
        assertThat(cards.get(0).links()).isNullOrEmpty();
        assertThat(cards.get(0).source().url()).contains("rule-not-required-7");
    }
}
