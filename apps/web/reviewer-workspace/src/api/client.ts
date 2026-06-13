const GRAPHQL_URL = import.meta.env['VITE_GRAPHQL_URL'] ?? '/graphql';

export interface SimCtx {
  tenant_id: string;
  cell_id: string;
  tier: 'pooled' | 'dedicated' | 'enclave';
  scopes: { lob: string[]; region: string[]; modules: string[] };
  roles: string[];
  principal_type: 'human' | 'service' | 'automation';
}

export async function gqlRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  ctx: SimCtx,
): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sim-ctx': btoa(JSON.stringify(ctx)),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);

  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) throw new Error(json.errors[0]!.message);
  return json.data as T;
}
