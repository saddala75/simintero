package com.simintero.enstellar.interop.crd;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.simintero.enstellar.interop.FhirTestBase;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

@Tag("integration")
class DigicoreClientIT extends FhirTestBase {

    static final WireMockServer DIGICORE_MOCK;

    static {
        DIGICORE_MOCK = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        DIGICORE_MOCK.start();
    }

    @AfterAll
    static void stop() {
        DIGICORE_MOCK.stop();
    }

    @DynamicPropertySource
    static void digicoreUrl(DynamicPropertyRegistry registry) {
        registry.add("enstellar.digicore.base-url", () -> "http://localhost:" + DIGICORE_MOCK.port());
    }

    @BeforeEach
    void reset() {
        DIGICORE_MOCK.resetAll();
    }

    @Autowired
    DigicoreClient client;

    @Test
    void get_crd_content_parses_digicore_response() {
        DIGICORE_MOCK.stubFor(get(urlPathEqualTo("/api/v1/crd"))
                .willReturn(okJson("""
                        {
                          "pa_required": true,
                          "documentation_requirements": ["clinical-notes", "diagnosis-codes"],
                          "rule_reference": "mock-rule-stub-v1",
                          "dtr_launch_url": "http://localhost:8080/dtr/launch"
                        }
                        """)));

        CrdContent content = client.getCrdContent("svc-1", "p1", "plan-1", "t1");

        assertThat(content.paRequired()).isTrue();
        assertThat(content.documentationRequirements())
                .containsExactly("clinical-notes", "diagnosis-codes");
        assertThat(content.ruleReference()).isEqualTo("mock-rule-stub-v1");
        assertThat(content.dtrLaunchUrl()).isEqualTo("http://localhost:8080/dtr/launch");
        DIGICORE_MOCK.verify(getRequestedFor(urlPathEqualTo("/api/v1/crd"))
                .withQueryParam("service_code", equalTo("svc-1"))
                .withQueryParam("tenant_id", equalTo("t1")));
    }
}
