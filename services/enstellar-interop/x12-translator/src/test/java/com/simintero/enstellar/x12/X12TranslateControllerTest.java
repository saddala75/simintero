package com.simintero.enstellar.x12;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.testcontainers.containers.localstack.LocalStackContainer.Service.S3;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Testcontainers
class X12TranslateControllerTest {

    @Container
    static LocalStackContainer localstack = new LocalStackContainer(
        DockerImageName.parse("localstack/localstack:3.4")
    ).withServices(S3);

    @DynamicPropertySource
    static void configureLocalStack(DynamicPropertyRegistry registry) {
        registry.add("minio.endpoint", () -> localstack.getEndpointOverride(S3).toString());
        registry.add("minio.access-key", () -> "test");
        registry.add("minio.secret-key", () -> "test");
        registry.add("minio.bucket", () -> "x12-controller-test");
    }

    @Autowired TestRestTemplate rest;

    static final String MINIMAL_278 =
        "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *240101*1200*^*00501*000000001*0*P*:~" +
        "GS*HS*SENDER*RECEIVER*20240101*1200*1*X*005010X217~" +
        "ST*278*0001~" +
        "BHT*0007*13*CORR-001*20240101*1200*RQ~" +
        "HL*1**20*1~" +
        "NM1*X3*2*PAYER*****PI*PAYER001~" +
        "HL*2*1*21*1~" +
        "NM1*1P*1*DOE*JANE****XX*1234567890~" +
        "HL*3*2*22*1~" +
        "NM1*IL*1*SMITH*JOHN****MI*MBR001~" +
        "HL*4*3*EV*0~" +
        "UM*HS*I*2~" +
        "HI*BK:M5410~" +
        "SV1*HC:99213*100*UN*1***1~" +
        "SE*15*0001~" +
        "GE*1*1~" +
        "IEA*1*000000001~";

    @Test
    @SuppressWarnings("unchecked")
    void x12ToCanonical_returnsCase() {
        var req = Map.of(
            "rawX12", MINIMAL_278,
            "tenantId", "test-tenant",
            "tradingPartnerId", "default"
        );
        var resp = rest.postForEntity("/translate/x12-to-canonical", req, Map.class);
        assertThat(resp.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(resp.getBody()).containsKey("case_id");
        assertThat(resp.getBody()).containsKey("correlation_id");
    }
}
