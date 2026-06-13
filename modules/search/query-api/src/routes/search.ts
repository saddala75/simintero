import express from 'express';
import type { Pool } from 'pg';
import { ulid } from 'ulid';
import { createHash } from 'node:crypto';

export function buildSearchRouter(pool: Pool): express.Router {
  const router = express.Router();

  // GET /v1/search — cross-module universal search
  router.get('/v1/search', async (req, res, next) => {
    try {
      // Validate tenant header
      const tenantId = req.headers['x-sim-tenant-id'] as string | undefined;
      if (!tenantId) {
        res.status(401).json({ error: 'Missing x-sim-tenant-id header' });
        return;
      }

      // Validate query param
      const q = (req.query['q'] as string | undefined) ?? '';
      if (!q) {
        res.status(400).json({ error: 'Missing or empty query parameter: q' });
        return;
      }

      // Parse optional entity_types filter
      const entityTypesParam = req.query['entity_types'] as string | undefined;
      const entityTypes: string[] =
        entityTypesParam && entityTypesParam.trim().length > 0
          ? entityTypesParam.split(',').map((t) => t.trim()).filter(Boolean)
          : [];

      // Parse optional limit (default 20, max 100)
      const limitParam = req.query['limit'] as string | undefined;
      const limit = Math.min(
        limitParam !== undefined ? Math.max(1, parseInt(limitParam, 10) || 20) : 20,
        100,
      );

      // Hash the query — raw q is NEVER written to any table
      const query_hash = createHash('sha256').update(q).digest('hex');

      // Build parameterized SQL
      const conditions: string[] = ['ie.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (entityTypes.length > 0) {
        params.push(entityTypes);
        conditions.push(`ie.entity_type = ANY($${params.length})`);
      }

      // Phase 4: simple substring search via ILIKE
      params.push(`%${q}%`);
      conditions.push(`ie.entity_id ILIKE $${params.length}`);

      params.push(Math.min(limit, 100));
      const sql = `SELECT ie.entity_id, ie.entity_type, ie.indexed_at
                   FROM search.index_event ie
                   WHERE ${conditions.join(' AND ')}
                   LIMIT $${params.length}`;

      const { rows } = await pool.query(sql, params);

      // Log search to search.search_log (PHI-safe: only the hash is stored)
      await pool.query(
        `INSERT INTO search.search_log (log_id, tenant_id, query_hash, entity_types, result_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [ulid(), tenantId, query_hash, entityTypes, rows.length],
      );

      // Build response — metadata not stored in index_event, return empty object; score fixed at 1.0
      const results = rows.map((row: { entity_id: string; entity_type: string; indexed_at: string }) => ({
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        metadata: {},
        score: 1.0,
      }));

      res.status(200).json({
        results,
        total: results.length,
        query_hash,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
