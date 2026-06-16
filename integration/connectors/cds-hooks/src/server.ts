import express from 'express';
import { createCdsHooksRouter } from './CdsHooksService.js';

const port = parseInt(process.env['PORT'] ?? '3050', 10);

const cfg = {
  controlPlaneUrl: process.env['CONTROL_PLANE_URL'] ?? 'http://localhost:3000',
  interopFhirBaseUrl: process.env['INTEROP_FHIR_BASE_URL'] ?? 'http://localhost:8080/fhir',
};

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cds-hooks', version: '0.1.0' });
});

app.use('/', createCdsHooksRouter(cfg));

app.listen(port, () => {
  console.log(`[cds-hooks] Service listening on port ${port}`);
});

export { app };
