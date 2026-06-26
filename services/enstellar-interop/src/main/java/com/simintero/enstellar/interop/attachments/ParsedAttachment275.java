package com.simintero.enstellar.interop.attachments;

public record ParsedAttachment275(
    String controlNumber,   // from TRN segment, correlates to rfai_correlation.control_number
    String claimId,         // from REF*EJ
    String tenantId,        // from REF*SIM
    String ccdaBase64,      // BIN segment content (base64-encoded C-CDA XML)
    String loincCode        // from PWK LOINC code field
) {}
