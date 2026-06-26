package com.simintero.enstellar.interop.attachments;

import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AttachmentProcessorTest {

    @Mock MinioClient minioClient;
    @Mock JdbcTemplate jdbc;
    @Mock ClaimsServiceClient claimsClient;

    AttachmentProcessor processor;

    @BeforeEach
    void setUp() {
        processor = new AttachmentProcessor(minioClient, jdbc, claimsClient, "documents");
    }

    /**
     * Plain unsigned C-CDA: {@code <?xml version="1.0"?><ClinicalDocument><component></component></ClinicalDocument>}
     * encoded as base64. No Signature element → pass-through allowed.
     */
    private static final String PLAIN_CCDA_B64 =
            "PD94bWwgdmVyc2lvbj0iMS4wIj8+PENsaW5pY2FsRG9jdW1lbnQ+PGNvbXBvbmVudD48L2NvbXBvbmVudD48L0NsaW5pY2FsRG9jdW1lbnQ+";

    private ParsedAttachment275 sampleAttachment() {
        return new ParsedAttachment275("RFAI-001", "CLM-001", "tenant-dev", PLAIN_CCDA_B64, "11506-3");
    }

    private Map<String, Object> sampleCorrelation() {
        return Map.of(
                "claim_id", "CLM-001",
                "case_ref", "case-001",
                "loinc_codes", new String[]{"11506-3"}
        );
    }

    // -----------------------------------------------------------------------

    @Test
    void returnsDocId() throws Exception {
        when(jdbc.queryForMap(any(String.class), any(Object.class))).thenReturn(sampleCorrelation());

        String docId = processor.process(sampleAttachment());

        assertThat(docId).isNotBlank();
    }

    @Test
    void storesDocumentInMinio() throws Exception {
        when(jdbc.queryForMap(any(String.class), any(Object.class))).thenReturn(sampleCorrelation());

        processor.process(sampleAttachment());

        verify(minioClient).putObject(
                argThat((PutObjectArgs args) ->
                        args.object().startsWith("attachments/tenant-dev/RFAI-001/")
                                && args.object().endsWith(".xml"))
        );
    }

    @Test
    void writesSignatureAuditRecord() throws Exception {
        when(jdbc.queryForMap(any(String.class), any(Object.class))).thenReturn(sampleCorrelation());

        processor.process(sampleAttachment());

        verify(jdbc).update(
                argThat((String sql) -> sql.contains("attachment_signature_audit")),
                any(Object[].class)
        );
    }

    @Test
    void notifiesClaimsServiceOnSuccess() throws Exception {
        when(jdbc.queryForMap(any(String.class), any(Object.class))).thenReturn(sampleCorrelation());

        processor.process(sampleAttachment());

        verify(claimsClient).notifyReceived(
                eq("CLM-001"), eq("case-001"), anyString(), eq("tenant-dev"), anyList()
        );
    }

    @Test
    void notifiesClaimsRejectedOnSigFailure() throws Exception {
        // C-CDA that contains a Signature element but is structurally invalid → triggers rejection
        // Base64 of: <ClinicalDocument><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo></SignedInfo></Signature></ClinicalDocument>
        String badCcda =
                "PENsaW5pY2FsRG9jdW1lbnQ+PFNpZ25hdHVyZSB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC8wOS94bWxkc2lnIyI+PFNpZ25lZEluZm8+PC9TaWduZWRJbmZvPjwvU2lnbmF0dXJlPjwvQ2xpbmljYWxEb2N1bWVudD4=";
        ParsedAttachment275 attachment = new ParsedAttachment275(
                "RFAI-002", "CLM-002", "tenant-dev", badCcda, "11506-3"
        );
        // For the rejection path we only need queryForMap for the claim_id lookup
        when(jdbc.queryForMap(any(String.class), any(Object.class)))
                .thenReturn(Map.of("claim_id", "CLM-002"));

        processor.process(attachment);

        verify(claimsClient).notifyRejected(eq("CLM-002"), eq("tenant-dev"), anyString());
        // Must NOT call notifyReceived
        verify(claimsClient, never()).notifyReceived(any(), any(), any(), any(), any());
    }
}
