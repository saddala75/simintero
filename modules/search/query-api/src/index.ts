import pg from 'pg';
import { buildApp } from './app.js';

const pool = new pg.Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero',
});
const PORT = Number(process.env['PORT'] ?? 3019);

buildApp(pool).listen(PORT, () => console.log(`search-query-api listening on :${PORT}`));
