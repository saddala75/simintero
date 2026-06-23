// modules/revital/pipeline/src/fabric/buildFabricResource.ts
export interface BuildFabricResourceArgs {
  fhir_id: string;
  resource_type: string;
  system: string;
  code: string;
  display?: string | undefined;
  raw_text: string;
  member_ref: string;
}

/** Build a minimal FHIR resource (JSONB content) from a coded Revital entity. Pure. */
export function buildFabricResource(args: BuildFabricResourceArgs): any {
  const coding: any = { system: args.system, code: args.code };
  if (args.display !== undefined) coding.display = args.display;

  const resource: any = {
    resourceType: args.resource_type,
    id: args.fhir_id,
    subject: { reference: `Patient/${args.member_ref}` },
    code: { coding: [coding], text: args.raw_text },
  };

  switch (args.resource_type) {
    case 'Condition':
      resource.clinicalStatus = {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
      };
      break;
    case 'Observation':
      resource.status = 'final';
      break;
    case 'Procedure':
      resource.status = 'completed';
      break;
    default:
      break; // generic: resourceType + id + subject + code only
  }
  return resource;
}
