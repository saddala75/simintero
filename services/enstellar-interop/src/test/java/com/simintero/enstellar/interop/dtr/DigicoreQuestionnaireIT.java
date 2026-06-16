package com.simintero.enstellar.interop.dtr;

import ca.uhn.fhir.context.FhirContext;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.simintero.enstellar.interop.FhirTestBase;
import com.simintero.enstellar.interop.crd.DigicoreClient;
import org.hl7.fhir.r4.model.Enumerations;
import org.hl7.fhir.r4.model.Questionnaire;
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
class DigicoreQuestionnaireIT extends FhirTestBase {

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
    void get_questionnaire_returns_parseable_artifact() {
        String packageRef = "urn:sim:dtr:knee-arthroscopy:1.0.0";
        // WebClient percent-encodes the path variable, so the colons arrive as %3A.
        String encodedRef = "urn%3Asim%3Adtr%3Aknee-arthroscopy%3A1.0.0";
        DIGICORE_MOCK.stubFor(post(urlPathEqualTo("/v1/runtime/coverage-discovery"))
                .withRequestBody(matchingJsonPath("$.service_code", equalTo("knee-arthroscopy")))
                .willReturn(okJson("""
                        {
                          "pa_required": true,
                          "governing_rules": [{"rule_id": "sim-knee-pa", "version": "1.0.0"}],
                          "pins": [],
                          "dtr_package_ref": "%s"
                        }
                        """.formatted(packageRef))));
        DIGICORE_MOCK.stubFor(get(urlPathEqualTo("/v1/runtime/dtr-packages/" + encodedRef)).willReturn(okJson("""
                {"resourceType":"Questionnaire","id":"dtr-knee","status":"active",
                 "item":[
                   {"linkId":"indication","text":"Clinical indication","type":"string"},
                   {"linkId":"tried-conservative","text":"Conservative therapy?","type":"boolean"},
                   {"linkId":"diagnosis","text":"Primary diagnosis","type":"string"}
                 ]}
                """)));

        String json = client.getQuestionnaire("knee-arthroscopy", "plan-1", "t1");
        Questionnaire q = FhirContext.forR4().newJsonParser().parseResource(Questionnaire.class, json);

        assertThat(q.getItem()).hasSize(3);
        assertThat(q.getStatus()).isEqualTo(Enumerations.PublicationStatus.ACTIVE);
        DIGICORE_MOCK.verify(postRequestedFor(urlPathEqualTo("/v1/runtime/coverage-discovery")));
        DIGICORE_MOCK.verify(getRequestedFor(urlPathEqualTo("/v1/runtime/dtr-packages/" + encodedRef)));
    }
}
