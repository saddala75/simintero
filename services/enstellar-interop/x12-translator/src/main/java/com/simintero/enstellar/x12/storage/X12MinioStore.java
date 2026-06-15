package com.simintero.enstellar.x12.storage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.nio.charset.StandardCharsets;

@Component
public class X12MinioStore {

    private static final Logger logger = LoggerFactory.getLogger(X12MinioStore.class);

    private final S3Client s3;

    @Value("${minio.bucket}")
    private String bucket;

    public X12MinioStore(S3Client s3) {
        this.s3 = s3;
    }

    public void store(String rawX12, String tenantId, String correlationId) {
        String key = objectKey(tenantId, correlationId);
        ensureBucketExists();
        s3.putObject(
            PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType("text/plain")
                .build(),
            RequestBody.fromBytes(rawX12.getBytes(StandardCharsets.UTF_8))
        );
        logger.debug("Stored X12 object: bucket={}, key={}", bucket, key);
    }

    public boolean exists(String tenantId, String correlationId) {
        try {
            s3.headObject(HeadObjectRequest.builder()
                .bucket(bucket)
                .key(objectKey(tenantId, correlationId))
                .build());
            return true;
        } catch (NoSuchKeyException | NoSuchBucketException e) {
            return false;
        }
    }

    private String objectKey(String tenantId, String correlationId) {
        return tenantId + "/" + correlationId + ".x12";
    }

    private void ensureBucketExists() {
        try {
            s3.createBucket(b -> b.bucket(bucket));
        } catch (BucketAlreadyExistsException | BucketAlreadyOwnedByYouException ignored) {
            // bucket exists — fine
        }
    }
}
