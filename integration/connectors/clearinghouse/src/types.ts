export interface ClearinghouseConfig {
  baseUrl: string;
  apiKey: string;
  submitterId: string;
}

export interface ClaimSubmission {
  claimId: string;
  tenantId: string;
  x12Payload: string;
}

export interface AckResult {
  controlNumber: string;
  status: 'accepted' | 'rejected' | 'accepted_with_errors' | 'pending';
  errors: AckError[];
}

export interface AckError {
  loopId: string;
  errorCode: string;
  description: string;
}

export interface RemittanceNotice {
  remittanceId: string;
  claimId: string;
  paidAmount: number;
  adjustmentCodes: string[];
}
