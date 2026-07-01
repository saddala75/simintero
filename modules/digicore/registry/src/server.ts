import '@sim/otel'
import * as pg from 'pg'
import { Client as OSClientRaw } from '@opensearch-project/opensearch'
import { createTenantDb } from '@sim/tenant-context-ts'
import { setDb, setOsClient } from './index.js'
import type { OSClient, OSSearchQuery, OSSearchResult } from './search/ArtifactSearchService.js'
import app from './index.js'

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero'
const OS_URL = process.env['OPENSEARCH_URL'] ?? 'http://opensearch:9200'
const PORT = Number(process.env['PORT'] ?? 3010)

const pool = new pg.Pool({ connectionString: DB_URL })
setDb(createTenantDb(pool))

const rawClient = new OSClientRaw({ node: OS_URL })
const osClientAdapter: OSClient = {
  async search(query: OSSearchQuery): Promise<OSSearchResult> {
    const result = await rawClient.search({
      index: 'artifacts',
      body: {
        query: {
          bool: {
            must: [
              { term: { tenant_id: query.tenant_id } }
            ]
          }
        }
      }
    })
    const hits = (result as any).body?.hits
    return {
      items: (hits?.hits || []).map((hit: any) => hit._source),
      total: typeof hits?.total === 'number' ? hits.total : (hits?.total?.value || 0)
    }
  }
}
setOsClient(osClientAdapter)

app.listen(PORT, () => console.log(`[digicore-registry] listening on :${PORT}`))
