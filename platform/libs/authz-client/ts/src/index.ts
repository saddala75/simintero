import { ctx } from "@sim/tenant-context-ts";

export interface OpaInput {
  action: string;
  resource: Record<string, unknown>;
}

interface OpaResult {
  result: boolean;
}

const OPA_URL = process.env["OPA_URL"] ?? "http://localhost:8181";
const OPA_TIMEOUT_MS = Number(process.env["OPA_TIMEOUT_MS"] ?? "2000");

export async function authorize(
  input: OpaInput,
  policy = "sim/guards/adverse_action/allow"
): Promise<void> {
  const tenantCtx = ctx();
  const payload = {
    input: {
      ...input,
      principal: {
        sim: {
          tenant_id: tenantCtx.tenant_id,
          roles: tenantCtx.roles,
          principal_type: tenantCtx.principal_type,
        },
      },
    },
  };

  const resp = await fetch(`${OPA_URL}/v1/data/${policy}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(OPA_TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`OPA unreachable: ${resp.status}`);
  }

  const data = (await resp.json()) as OpaResult;
  if (!data.result) {
    throw Object.assign(new Error("Forbidden"), { code: "SIM-AUTHZ-0001", status: 403 });
  }
}
