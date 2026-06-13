import { createContext, useContext, type ReactNode } from 'react';
import type { SimCtx } from './client.js';

const DEFAULT_CTX: SimCtx = {
  tenant_id: (import.meta.env['VITE_TENANT_ID'] as string | undefined) ?? 't_synth_ma',
  cell_id: (import.meta.env['VITE_CELL_ID'] as string | undefined) ?? 'cell_us_east_1',
  tier: 'pooled',
  scopes: {
    lob: ['MA'],
    region: ['us-east-1'],
    modules: ['enstellar', 'revital'],
  },
  roles: ['medical_director'],
  principal_type: 'human',
};

const SimCtxContext = createContext<SimCtx>(DEFAULT_CTX);

export function SimCtxProvider({ children }: { children: ReactNode }) {
  return (
    <SimCtxContext.Provider value={DEFAULT_CTX}>
      {children}
    </SimCtxContext.Provider>
  );
}

export function useSimCtx(): SimCtx {
  return useContext(SimCtxContext);
}
