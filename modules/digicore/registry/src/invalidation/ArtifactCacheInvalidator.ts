import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

export interface ArtifactActivatedPayload {
  canonical_url: string;
  [key: string]: unknown;
}

/**
 * Handles sim.artifact/ArtifactActivated events by purging all
 * dig.artifact_cache rows for the activated canonical_url.
 * The DELETE runs inside a transaction so it is atomic and RLS-scoped.
 */
export class ArtifactCacheInvalidator {
  constructor(private readonly db: TenantDb) {}

  async handleArtifactActivated(
    payload: ArtifactActivatedPayload
  ): Promise<void> {
    // Ensure a valid tenant context exists — throws if middleware was skipped
    ctx();

    await this.db.transaction(async (client) => {
      await client.query(
        'DELETE FROM dig.artifact_cache WHERE canonical_url = $1',
        [payload.canonical_url]
      );
    });
  }
}
