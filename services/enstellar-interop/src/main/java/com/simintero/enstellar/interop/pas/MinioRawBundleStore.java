package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.context.FhirContext;
import com.simintero.enstellar.interop.config.PasConfig;
import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import org.hl7.fhir.r4.model.Bundle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneOffset;

@Component
public class MinioRawBundleStore {

    private static final Logger log = LoggerFactory.getLogger(MinioRawBundleStore.class);

    private final MinioClient minioClient;
    private final String bucket;
    private final FhirContext fhirContext;

    public MinioRawBundleStore(PasConfig config, FhirContext fhirContext) {
        this.fhirContext = fhirContext;
        PasConfig.MinioProps minio = config.minio();
        this.bucket = minio.bucket();
        this.minioClient = MinioClient.builder()
            .endpoint("http" + (minio.secure() ? "s" : "") + "://" + minio.endpoint())
            .credentials(minio.accessKey(), minio.secretKey())
            .build();
    }

    public String store(String tenantId, String correlationId, Bundle bundle) {
        String json = fhirContext.newJsonParser()
            .setPrettyPrint(false)
            .encodeResourceToString(bundle);

        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        String date = LocalDate.now(ZoneOffset.UTC).toString();
        String objectKey = tenantId + "/raw-bundles/" + date + "/" + correlationId + ".json";

        try {
            ensureBucket();
            minioClient.putObject(
                PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(objectKey)
                    .stream(new ByteArrayInputStream(bytes), bytes.length, -1)
                    .contentType("application/fhir+json")
                    .build()
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to store raw bundle in MinIO: " + e.getMessage(), e);
        }

        String fullKey = bucket + "/" + objectKey;
        log.info("raw_bundle_stored tenant={} correlation_id={} key={}", tenantId, correlationId, fullKey);
        return fullKey;
    }

    private void ensureBucket() throws Exception {
        boolean exists = minioClient.bucketExists(
            BucketExistsArgs.builder().bucket(bucket).build()
        );
        if (!exists) {
            minioClient.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
        }
    }
}
