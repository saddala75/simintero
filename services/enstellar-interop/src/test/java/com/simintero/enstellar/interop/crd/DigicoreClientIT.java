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
    void get_crd_content_assembles_from_c1_runtime() {
        DIGICORE_MOCK.stubFor(post(urlPathEqualTo("/v1/runtime/coverage-discovery"))
                .withRequestBody(matchingJsonPath("$.service_code", equalTo("knee-arthroscopy")))
                .withRequestBody(matchingJsonPath("$.procedure_code", equalTo("knee-arthroscopy")))
                .willReturn(okJson("""
                        {
                          "pa_required": true,
                          "governing_rules": [{"rule_id": "sim-knee-pa", "version": "1.0.0"}],
                          "pins": ["pin-1"],
                          "dtr_package_ref": "urn:sim:dtr:knee-arthroscopy:1.0.0"
                        }
                        """)));
        DIGICORE_MOCK.stubFor(post(urlPathEqualTo("/v1/runtime/evidence-requirements:resolve"))
                .withRequestBody(matchingJsonPath("$.service_code", equalTo("knee-arthroscopy")))
                .willReturn(okJson("""
                        {
                          "service_code": "knee-arthroscopy",
                          "requirements": [
                            {"requirement_id": "r1", "display": "Conservative therapy tried", "required": true},
                            {"requirement_id": "r2", "display": "Imaging report", "required": true},
                            {"requirement_id": "r3", "display": "Symptom duration", "required": true}
                          ]
                        }
                        """)));

        CrdContent content = client.getCrdContent("knee-arthroscopy", "p1", "plan-1", "t1");

        assertThat(content.paRequired()).isTrue();
        assertThat(content.ruleReference()).isEqualTo("sim-knee-pa");
        assertThat(content.documentationRequirements())
                .containsExactly("Conservative therapy tried", "Imaging report", "Symptom duration");
        assertThat(content.dtrLaunchUrl()).isNotNull();
        DIGICORE_MOCK.verify(postRequestedFor(urlPathEqualTo("/v1/runtime/coverage-discovery")));
        DIGICORE_MOCK.verify(postRequestedFor(urlPathEqualTo("/v1/runtime/evidence-requirements:resolve")));
    }
}
