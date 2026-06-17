package com.simintero.enstellar.interop.document;

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
class DocumentServiceClientIT extends FhirTestBase {

    static final WireMockServer DOC_MOCK;

    static {
        DOC_MOCK = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        DOC_MOCK.start();
    }

    @AfterAll
    static void stop() { DOC_MOCK.stop(); }

    @DynamicPropertySource
    static void docUrl(DynamicPropertyRegistry registry) {
        registry.add("enstellar.document-service.base-url", () -> "http://localhost:" + DOC_MOCK.port());
    }

    @BeforeEach
    void reset() { DOC_MOCK.resetAll(); }

    @Autowired
    DocumentServiceClient client;

    @Test
    void ingest_posts_document_with_case_ref_and_tenant_header() {
        DOC_MOCK.stubFor(post(urlPathEqualTo("/documents/ingest"))
                .willReturn(aResponse().withStatus(202)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{\"doc_id\":\"doc-123\"}")));

        String docId = client.ingest("fhir_binary", "cGF5bG9hZA==", "corr-1", "t_test");

        assertThat(docId).isEqualTo("doc-123");
        DOC_MOCK.verify(postRequestedFor(urlPathEqualTo("/documents/ingest"))
                .withHeader("x-sim-tenant-id", equalTo("t_test"))
                .withRequestBody(matchingJsonPath("$.channel", equalTo("fhir_binary")))
                .withRequestBody(matchingJsonPath("$.raw_payload", equalTo("cGF5bG9hZA==")))
                .withRequestBody(matchingJsonPath("$.case_ref", equalTo("corr-1")))
                .withRequestBody(matchingJsonPath("$.created_by.type", equalTo("service")))
                .withRequestBody(matchingJsonPath("$.created_by.id", equalTo("enstellar-interop"))));
    }
}
