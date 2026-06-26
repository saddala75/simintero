import '@sim/otel'
import { enrichSpan } from '@sim/otel'
import express, { type Application, type Request, type Response, type NextFunction } from "express";
import { Pool } from "pg";
import { createCtrlDb } from "./db/index.js";
import { CellAssigner } from "./provisioning/CellAssigner.js";
import { OperationTracker } from "./provisioning/OperationTracker.js";
import { TenantLifecycle } from "./lifecycle/TenantLifecycle.js";
import { TenantEventPublisher } from "./events/TenantEventPublisher.js";
import { createTenantsRouter } from "./routes/tenants.js";
import { createCellsRouter } from "./routes/cells.js";
import { createEntitlementsRouter } from "./routes/entitlements.js";
import { createOperationsRouter } from "./routes/operations.js";
import { createSupportRouter } from "./routes/support.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://localhost/simintero_ctrl";
const PORT = Number(process.env["PORT"] ?? 4040);

const pool = new Pool({ connectionString: DATABASE_URL });
const db = createCtrlDb(pool);

const cellAssigner = new CellAssigner(db);
const tracker = new OperationTracker(db);
const lifecycle = new TenantLifecycle();
const publisher = new TenantEventPublisher();

const app: Application = express();
app.use(express.json());

app.use((req: Request, _res: Response, next: NextFunction) => {
  const tenantId = (req as any).tenantId ?? (req.headers['x-tenant-id'] as string | undefined)
  const sub = (req as any).sub as string | undefined
  if (tenantId) enrichSpan({ tenant_id: tenantId })
  if (sub) enrichSpan({ 'user.sub': sub })
  next()
})

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// v1 routes
const tenantsRouter = createTenantsRouter(db, cellAssigner, tracker, publisher, lifecycle);
const entitlementsRouter = createEntitlementsRouter(db, publisher);

app.use("/v1/tenants", tenantsRouter);
// Mount entitlements as a sub-path of tenants
app.use("/v1/tenants/:id/entitlements", entitlementsRouter);
app.use("/v1/cells", createCellsRouter(db));
app.use("/v1/operations", createOperationsRouter(tracker));
app.use("/v1/support", createSupportRouter(db, lifecycle, publisher));

app.listen(PORT, () => {
  console.log(`control-plane listening on :${PORT}`);
});

export { app };
