package com.simintero.enstellar.interop.pas;

import com.simintero.enstellar.interop.decision.DecisionStore;
import com.simintero.enstellar.interop.document.PasDocumentIngestor;
import com.simintero.enstellar.interop.pas.dto.NormalizeResponse;
import io.simintero.tenant.TenantContext;
import io.simintero.tenant.TenantContextHolder;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PasClaimSubmitProviderIngestTest {

    private MinioRawBundleStore minio;
    private PasBundleValidator validator;
    private NormalizationClient normClient;
    private CaseIntakePublisher publisher;
    private DecisionStore decisionStore;
    private PasDocumentIngestor ingestor;
    private PasClaimSubmitProvider provider;

    @BeforeEach
    void setUp() {
        minio = mock(MinioRawBundleStore.class);
        validator = mock(PasBundleValidator.class);
        normClient = mock(NormalizationClient.class);
        publisher = mock(CaseIntakePublisher.class);
        decisionStore = mock(DecisionStore.class);
        ingestor = mock(PasDocumentIngestor.class);
        provider = new PasClaimSubmitProvider(minio, validator, normClient, publisher, decisionStore, ingestor);

        when(minio.store(anyString(), anyString(), any())).thenReturn("raw-key");
        when(normClient.normalize(any(), anyString(), anyString()))
                .thenReturn(new NormalizeResponse(
                        UUID.randomUUID().toString(), "t_test", "corr-77", "queued", "MA", "raw-key"));
        // TenantContext is a 6-field record: (tenantId, cellId, tier, scopes, roles, principalType).
        TenantContextHolder.set(new TenantContext(
                "t_test", "cell-1", "pooled", TenantContext.Scopes.empty(), java.util.List.of(), "service"));
    }

    @AfterEach
    void tearDown() {
        TenantContextHolder.clear();
    }

    private Bundle bundleWithClaim() {
        Bundle b = new Bundle();
        b.setId("corr-77");
        b.setType(Bundle.BundleType.COLLECTION);
        b.addEntry().setResource(new Claim());
        return b;
    }

    @Test
    void submit_invokes_ingestor_with_correlation_id_and_tenant() {
        provider.submit(bundleWithClaim());
        verify(ingestor).ingest(any(Bundle.class), eq("corr-77"), eq("t_test"));
    }
}
