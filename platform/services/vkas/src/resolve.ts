export interface ArtifactRow {
  canonical_url: string;
  version: string;
  tenant_id: string;
  artifact_type: string;
  status: string;
  effective_from: Date | null;
  effective_to: Date | null;
  applicability: Record<string, unknown>;
  content: unknown;
  content_hash: string;
  relations: unknown[];
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: Date;
}

export interface ResolveOptions {
  asOf: Date;
  ctx: {
    lob?: string;
    region?: string;
    program?: string;
    product?: string;
  };
}

export function resolveEffectiveVersion(
  candidates: ArtifactRow[],
  options: ResolveOptions
): ArtifactRow | null {
  const { asOf, ctx } = options;

  const matching = candidates.filter((a) => {
    if (a.status !== "active") return false;

    const from = a.effective_from ? a.effective_from.getTime() : 0;
    const to = a.effective_to ? a.effective_to.getTime() : Infinity;
    if (asOf.getTime() < from || asOf.getTime() >= to) return false;

    // Applicability match: artifact dimension must include the context value
    const app = a.applicability as Record<string, string[]>;
    if (app["lob"] && ctx.lob && !app["lob"].includes(ctx.lob)) return false;
    if (app["region"] && ctx.region && !app["region"].includes(ctx.region)) return false;
    if (app["program"] && ctx.program && !app["program"].includes(ctx.program)) return false;
    if (app["product"] && ctx.product && !app["product"].includes(ctx.product)) return false;

    return true;
  });

  if (matching.length === 0) return null;

  // Sort by version descending (semver)
  matching.sort((a, b) => compareSemver(b.version, a.version));
  return matching[0] ?? null;
}

function compareSemver(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0, aPatch = 0] = a.split(".").map(Number);
  const [bMajor = 0, bMinor = 0, bPatch = 0] = b.split(".").map(Number);
  return (
    (aMajor - bMajor) * 1_000_000 +
    (aMinor - bMinor) * 1_000 +
    (aPatch - bPatch)
  );
}
