import express from 'express';
import { createYoga, createSchema } from 'graphql-yoga';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import { createTenantDb } from '@sim/tenant-context-ts';
import { simAuthMiddleware } from './auth/authMiddleware.js';
import { worklist } from './resolvers/worklist.js';
import { caseDetail } from './resolvers/caseDetail.js';
import { resolveTrace } from './resolvers/trace.js';
import { advisory } from './resolvers/advisory.js';
import { recordDecision } from './mutations/recordDecision.js';
import { routeCase } from './mutations/routeCase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const typeDefs = readFileSync(join(__dirname, 'schema.graphql'), 'utf-8');

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero';
const PORT = Number(process.env['PORT'] ?? 4010);

const pool = new pg.Pool({ connectionString: DB_URL });
const db = createTenantDb(pool);

const schema = createSchema({
  typeDefs,
  resolvers: {
    Query: {
      worklist: (_: unknown, args: Parameters<typeof worklist>[1]) => worklist(db, args),
      case: (_: unknown, { caseId }: { caseId: string }) => caseDetail(db, caseId),
      trace: (_: unknown, { traceRef }: { traceRef: string }) => resolveTrace(traceRef),
      advisory: (_: unknown, { caseId, analysisId }: { caseId: string; analysisId?: string }) =>
        advisory(caseId, analysisId ?? null),
    },
    Mutation: {
      recordDecision: (_: unknown, { input }: { input: Parameters<typeof recordDecision>[0] }) =>
        recordDecision(input),
      routeCase: (_: unknown, { input }: { input: Parameters<typeof routeCase>[0] }) =>
        routeCase(input),
    },
  },
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  landingPage: false,
});

const app: import('express').Express = express();

app.use(simAuthMiddleware);
app.use(yoga.graphqlEndpoint, yoga);

app.listen(PORT, () => {
  console.log(`Workspace BFF listening on :${PORT}${yoga.graphqlEndpoint}`);
});

export { app };
