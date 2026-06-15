package com.simintero.enstellar.x12;

import com.simintero.enstellar.canonical.Case;
import com.simintero.enstellar.x12.service.X12InboundService;
import com.simintero.enstellar.x12.service.X12InboundService.CanonicalResult;
import com.simintero.enstellar.x12.service.X12OutboundService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.testcontainers.containers.localstack.LocalStackContainer.Service.S3;

@SpringBootTest
@ActiveProfiles("test")
@Testcontainers
class X12RoundTripTest {

    @Container
    static LocalStackContainer localstack = new LocalStackContainer(
        DockerImageName.parse("localstack/localstack:3.4")
    ).withServices(S3);

    @DynamicPropertySource
    static void configureLocalStack(DynamicPropertyRegistry registry) {
        registry.add("minio.endpoint", () -> localstack.getEndpointOverride(S3).toString());
        registry.add("minio.access-key", () -> "test");
        registry.add("minio.secret-key", () -> "test");
        registry.add("minio.bucket", () -> "x12-roundtrip-test");
    }

    @Autowired X12InboundService inboundService;
    @Autowired X12OutboundService outboundService;

    static final String STANDARD_FIXTURE =
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
        "DMG*D8*19800101*M~" +
        "HL*4*3*EV*0~" +
        "UM*HS*I*2~" +
        "HI*BK:M5410~" +
        "SV1*HC:99213*100*UN*1***1~" +
        "SE*17*0001~" +
        "GE*1*1~" +
        "IEA*1*000000001~";

    static final String EXPEDITED_FIXTURE =
        "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *240101*1200*^*00501*000000002*0*P*:~" +
        "GS*HS*SENDER*RECEIVER*20240101*1200*2*X*005010X217~" +
        "ST*278*0002~" +
        "BHT*0007*13*CORR-002*20240101*1200*RQ~" +
        "HL*1**20*1~" +
        "NM1*X3*2*PAYER2*****PI*PAYER002~" +
        "HL*2*1*21*1~" +
        "NM1*1P*1*ROE*RICHARD****XX*9876543210~" +
        "HL*3*2*22*1~" +
        "NM1*IL*1*JONES*ALICE****MI*MBR002~" +
        "HL*4*3*EV*0~" +
        "UM*HS*I*1~" +
        "HI*BK:Z00.00~" +
        "SV1*HC:99214*50*UN*1***1~" +
        "SE*15*0002~" +
        "GE*1*2~" +
        "IEA*1*000000002~";

    static Stream<Arguments> fixtures() {
        return Stream.of(
            Arguments.of(STANDARD_FIXTURE, "default"),
            Arguments.of(EXPEDITED_FIXTURE, "default")
        );
    }

    @ParameterizedTest
    @MethodSource("fixtures")
    void roundTrip_preservesRequiredFields(String rawX12, String tradingPartner) {
        CanonicalResult first = inboundService.parseAndStore(rawX12, "round-trip-tenant", tradingPartner);
        String outbound = outboundService.caseToX12(first.canonicalCase(), tradingPartner);
        CanonicalResult second = inboundService.parseAndStore(outbound, "round-trip-tenant", tradingPartner);

        Case c1 = first.canonicalCase();
        Case c2 = second.canonicalCase();

        assertThat(c2.requestingProvider().npi())
            .isEqualTo(c1.requestingProvider().npi());
        assertThat(c2.serviceLines()).hasSameSizeAs(c1.serviceLines());
        assertThat(c2.serviceLines().get(0).procedureCode())
            .isEqualTo(c1.serviceLines().get(0).procedureCode());
        assertThat(second.correlationId()).isNotBlank();
    }
}
