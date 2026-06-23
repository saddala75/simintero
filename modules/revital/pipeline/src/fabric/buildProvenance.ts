// modules/revital/pipeline/src/fabric/buildProvenance.ts
export interface BuildProvenanceArgs {
  provenance_fhir_id: string;
  target_resource_type: string;
  target_fhir_id: string;
  request_id: string;
  document_refs: string[];
  model_agent?: string | undefined;
}

const AI_REQUEST_ID_EXT = 'https://simintero.io/fhir/StructureDefinition/ai-request-id';

/** Build a minimal `ai_citation` FHIR Provenance for an AI-extracted resource. Pure. */
export function buildProvenance(args: BuildProvenanceArgs): any {
  return {
    resourceType: 'Provenance',
    id: args.provenance_fhir_id,
    target: [{ reference: `${args.target_resource_type}/${args.target_fhir_id}` }],
    agent: [
      {
        type: { text: 'ai-extraction' },
        who: { display: args.model_agent ?? 'ai-extraction' },
      },
    ],
    entity: args.document_refs.map((ref) => ({
      role: 'source',
      what: { reference: `DocumentReference/${ref}` },
    })),
    extension: [{ url: AI_REQUEST_ID_EXT, valueString: args.request_id }],
  };
}
