export interface CdsHook {
  id: string;
  hook: 'patient-view' | 'order-select' | 'order-sign';
  title: string;
  description: string;
  prefetch?: Record<string, string>;
}

export interface CdsRequest {
  hookInstance: string;
  hook: string;
  context: {
    patientId: string;
    userId: string;
    encounterId?: string;
    draftOrders?: {
      resourceType: 'Bundle';
      entry: Array<{ resource: { resourceType: string; code?: { coding?: Array<{ code: string; system: string }> } } }>;
    };
  };
  prefetch?: Record<string, unknown>;
}

export interface CdsCard {
  summary: string;
  detail?: string;
  indicator: 'info' | 'warning' | 'critical';
  source: { label: string; url?: string };
  suggestions?: CdsSuggestion[];
  links?: CdsLink[];
}

export interface CdsSuggestion {
  label: string;
  uuid: string;
  actions?: Array<{ type: 'create' | 'update' | 'delete'; description: string }>;
}

export interface CdsLink {
  label: string;
  url: string;
  type: 'absolute' | 'smart';
}

export interface CdsResponse {
  cards: CdsCard[];
}

export interface CdsHooksConfig {
  controlPlaneUrl: string;
  fhirFacadeUrl: string;
}
