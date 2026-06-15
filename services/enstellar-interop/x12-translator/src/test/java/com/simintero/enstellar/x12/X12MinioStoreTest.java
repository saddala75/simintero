package com.simintero.enstellar.x12;

import com.simintero.enstellar.x12.storage.X12MinioStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import static org.assertj.core.api.Assertions.assertThat;
import static org.testcontainers.containers.localstack.LocalStackContainer.Service.S3;

@SpringBootTest
@ActiveProfiles("test")
@Testcontainers
class X12MinioStoreTest {

    @Container
    static LocalStackContainer localstack = new LocalStackContainer(
        DockerImageName.parse("localstack/localstack:3.4")
    ).withServices(S3);

    @DynamicPropertySource
    static void configureLocalStack(DynamicPropertyRegistry registry) {
        registry.add("minio.endpoint", () -> localstack.getEndpointOverride(S3).toString());
        registry.add("minio.access-key", () -> "test");
        registry.add("minio.secret-key", () -> "test");
        registry.add("minio.bucket", () -> "x12-raw-test");
    }

    @Autowired
    X12MinioStore store;

    @Test
    void store_rawX12_thenObjectExistsInBucket() {
        String raw = "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *240101*1200*^*00501*000000001*0*P*:~";
        String tenantId = "test-tenant";
        String correlationId = "CORR-001";

        store.store(raw, tenantId, correlationId);
        assertThat(store.exists(tenantId, correlationId)).isTrue();
    }

    @Test
    void exists_nonExistentObject_returnsFalse() {
        assertThat(store.exists("missing-tenant", "MISSING-001")).isFalse();
    }
}
