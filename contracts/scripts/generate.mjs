import { mkdirSync } from 'fs';
import { execSync } from 'child_process';

const specs = [
  ['c1-digicore-runtime',    'openapi/c1-digicore-runtime.yaml'],
  ['c2-revital-advisory',    'openapi/c2-revital-advisory.yaml'],
  ['platform-vkas',          'openapi/platform-vkas.yaml'],
  ['platform-control-plane', 'openapi/platform-control-plane.yaml'],
  ['platform-model-gateway', 'openapi/platform-model-gateway.yaml'],
];

for (const [name, input] of specs) {
  const out = `../platform/libs/generated/${name}`;
  mkdirSync(out, { recursive: true });
  execSync(`npx openapi-typescript ${input} -o ${out}/types.ts`, { stdio: 'inherit' });
}
