package com.simintero.enstellar.interop.attachments;

import com.simintero.enstellar.interop.config.PasConfig;
import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import org.apache.xml.security.Init;
import org.apache.xml.security.keys.KeyInfo;
import org.apache.xml.security.signature.XMLSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Core processor for inbound CMS X12 275 C-CDA attachments.
 * <ol>
 *   <li>Optionally verifies XMLDSig (pass-through if unsigned; OCSP/CRL deferred to Phase 6.3).</li>
 *   <li>Stores the C-CDA in MinIO under {@code attachments/{tenantId}/{rfaiId}/{uuid}.xml}.</li>
 *   <li>Updates {@code interop.rfai_correlation} and writes {@code interop.attachment_signature_audit}.</li>
 *   <li>Calls {@link ClaimsServiceClient} to notify received or rejected.</li>
 * </ol>
 */
@Component
public class AttachmentProcessor {

    static {
        // Apache Santuario requires explicit one-time initialization
        Init.init();
    }

    private static final Logger log = LoggerFactory.getLogger(AttachmentProcessor.class);

    private final MinioClient minioClient;
    private final JdbcTemplate jdbc;
    private final ClaimsServiceClient claimsClient;
    private final String bucket;

    /** Spring-wired constructor: builds MinioClient from PasConfig (matches existing pattern). */
    public AttachmentProcessor(PasConfig config, JdbcTemplate jdbc, ClaimsServiceClient claimsClient) {
        PasConfig.MinioProps minio = config.minio();
        this.minioClient = MinioClient.builder()
                .endpoint("http" + (minio.secure() ? "s" : "") + "://" + minio.endpoint())
                .credentials(minio.accessKey(), minio.secretKey())
                .build();
        this.bucket = minio.bucket();
        this.jdbc = jdbc;
        this.claimsClient = claimsClient;
    }

    /**
     * Package-private testing constructor: accepts a pre-built {@link MinioClient} and bucket name.
     * Used by {@code AttachmentProcessorTest} to inject mocks without a Spring context.
     */
    AttachmentProcessor(MinioClient minioClient, JdbcTemplate jdbc,
                        ClaimsServiceClient claimsClient, String bucket) {
        this.minioClient = minioClient;
        this.jdbc = jdbc;
        this.claimsClient = claimsClient;
        this.bucket = bucket;
    }

    /**
     * Process an inbound C-CDA attachment.
     *
     * @return docId (UUID) stored in MinIO, or {@code null} if the attachment was rejected
     */
    public String process(ParsedAttachment275 attachment) {
        byte[] ccdaBytes;
        try {
            ccdaBytes = Base64.getDecoder().decode(attachment.ccdaBase64());
        } catch (Exception ex) {
            log.warn("[attachment-processor] base64-decode failed rfaiId={}", attachment.controlNumber());
            rejectAndAudit(attachment, null, "BASE64_DECODE_FAILED");
            return null;
        }

        // Verify XMLDSig if present; unsigned C-CDAs are allowed (pass-through)
        SigVerificationResult sigResult = verifyXmlDsig(ccdaBytes);
        if (!sigResult.valid()) {
            rejectAndAudit(attachment, sigResult, sigResult.rejectionReason());
            return null;
        }

        // Store in MinIO
        String docId = UUID.randomUUID().toString();
        String objectKey = "attachments/" + attachment.tenantId() + "/"
                + attachment.controlNumber() + "/" + docId + ".xml";
        storeInMinio(objectKey, ccdaBytes);

        // Update rfai_correlation to mark this RFAI as fulfilled
        jdbc.update(
                "UPDATE interop.rfai_correlation SET fulfilled_at = NOW(), doc_id = ? WHERE rfai_id = ?",
                docId, attachment.controlNumber()
        );

        // Write signature audit record
        writeAudit(attachment.controlNumber(), docId, attachment.tenantId(), sigResult, true, null);

        // Look up claim/case info from rfai_correlation
        Map<String, Object> correlation;
        try {
            correlation = jdbc.queryForMap(
                    "SELECT claim_id, case_ref, loinc_codes FROM interop.rfai_correlation WHERE rfai_id = ?",
                    attachment.controlNumber()
            );
        } catch (Exception ex) {
            log.error("[attachment-processor] rfai_correlation lookup failed rfaiId={}",
                    attachment.controlNumber());
            return docId;
        }

        String claimId = (String) correlation.get("claim_id");
        String caseRef = (String) correlation.get("case_ref");
        Object loincRaw = correlation.get("loinc_codes");
        List<String> loincCodes = loincRaw instanceof String[] arr ? Arrays.asList(arr) : List.of();

        claimsClient.notifyReceived(claimId, caseRef, docId, attachment.tenantId(), loincCodes);
        log.info("[attachment-processor] processed rfaiId={} docId={} tenant={}",
                attachment.controlNumber(), docId, attachment.tenantId());
        return docId;
    }

    // ------------------------------------------------------------------ private

    private void storeInMinio(String objectKey, byte[] bytes) {
        try {
            boolean exists = minioClient.bucketExists(
                    BucketExistsArgs.builder().bucket(bucket).build());
            if (!exists) {
                minioClient.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
            }
            minioClient.putObject(
                    PutObjectArgs.builder()
                            .bucket(bucket)
                            .object(objectKey)
                            .stream(new ByteArrayInputStream(bytes), bytes.length, -1)
                            .contentType("application/xml")
                            .build()
            );
        } catch (Exception ex) {
            throw new RuntimeException("Failed to store attachment in MinIO: " + ex.getMessage(), ex);
        }
    }

    private void rejectAndAudit(ParsedAttachment275 attachment,
                                 SigVerificationResult sig, String reason) {
        writeAudit(attachment.controlNumber(), null, attachment.tenantId(), sig, false, reason);
        try {
            Map<String, Object> correlation = jdbc.queryForMap(
                    "SELECT claim_id FROM interop.rfai_correlation WHERE rfai_id = ?",
                    attachment.controlNumber()
            );
            String claimId = (String) correlation.get("claim_id");
            claimsClient.notifyRejected(claimId, attachment.tenantId(), reason);
        } catch (Exception ex) {
            log.error("[attachment-processor] rejection-notify failed rfaiId={}",
                    attachment.controlNumber());
        }
    }

    private void writeAudit(String rfaiId, String docId, String tenantId,
                             SigVerificationResult sig, boolean valid, String reason) {
        String certSubject = sig != null ? sig.certSubject() : null;
        String certSha256 = sig != null ? sig.certSha256() : null;
        jdbc.update(
                "INSERT INTO interop.attachment_signature_audit "
                        + "(rfai_id, doc_id, tenant_id, cert_subject, cert_sha256, sig_valid, rejection_reason) "
                        + "VALUES (?,?,?,?,?,?,?)",
                rfaiId, docId, tenantId, certSubject, certSha256, valid, reason
        );
    }

    private SigVerificationResult verifyXmlDsig(byte[] ccdaBytes) {
        // Parse to DOM
        Document doc;
        try {
            DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
            dbf.setNamespaceAware(true);
            DocumentBuilder db = dbf.newDocumentBuilder();
            doc = db.parse(new ByteArrayInputStream(ccdaBytes));
        } catch (Exception ex) {
            return SigVerificationResult.invalid("XML_PARSE_ERROR");
        }

        // If no Signature element, this is an unsigned C-CDA — pass-through is allowed
        var sigElements = doc.getElementsByTagNameNS(
                "http://www.w3.org/2000/09/xmldsig#", "Signature");
        if (sigElements.getLength() == 0) {
            return SigVerificationResult.unsigned();
        }

        // Verify XMLDSig using Apache Santuario
        // OCSP/CRL revocation checking is deferred to Phase 6.3
        try {
            XMLSignature xmlSig = new XMLSignature(
                    (org.w3c.dom.Element) sigElements.item(0),
                    doc.getDocumentURI() != null ? doc.getDocumentURI() : ""
            );
            KeyInfo keyInfo = xmlSig.getKeyInfo();
            if (keyInfo == null) {
                return SigVerificationResult.invalid("NO_KEY_INFO");
            }

            X509Certificate cert = keyInfo.getX509Certificate();
            if (cert == null) {
                return SigVerificationResult.invalid("NO_X509_CERT");
            }

            boolean valid = xmlSig.checkSignatureValue(cert.getPublicKey());
            if (!valid) {
                return SigVerificationResult.invalid("SIG_INVALID");
            }

            String sha256 = HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(cert.getEncoded())
            );
            return SigVerificationResult.valid(cert.getSubjectX500Principal().getName(), sha256);
        } catch (Exception ex) {
            log.warn("[attachment-processor] xmldsig verification exception: {}", ex.getMessage());
            return SigVerificationResult.invalid("SIG_VERIFICATION_ERROR");
        }
    }

    /** Immutable result of XMLDSig verification. */
    public record SigVerificationResult(
            boolean valid,
            String certSubject,
            String certSha256,
            String rejectionReason
    ) {
        static SigVerificationResult valid(String subject, String sha256) {
            return new SigVerificationResult(true, subject, sha256, null);
        }

        static SigVerificationResult unsigned() {
            return new SigVerificationResult(true, null, null, null);
        }

        static SigVerificationResult invalid(String reason) {
            return new SigVerificationResult(false, null, null, reason);
        }
    }
}
