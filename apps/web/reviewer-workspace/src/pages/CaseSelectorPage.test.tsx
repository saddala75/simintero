import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../api/client', () => ({
  getWorklist: vi.fn().mockResolvedValue([
    {
      case_id: 'abc-123',
      member_name: 'Jane Smith',
      service_description: 'Total knee arthroplasty',
      lob: 'commercial',
      status: 'clinical_review',
      urgency: 'standard',
    },
  ]),
}))

vi.mock('../auth/AuthContext', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ ready: true, authenticated: true, sub: 'u-1' }),
}))

import { CaseSelectorPage } from './CaseSelectorPage'

describe('CaseSelectorPage', () => {
  it('renders worklist items after loading', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CaseSelectorPage />
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(await screen.findByText('Jane Smith')).toBeTruthy()
    expect(screen.getByText('Total knee arthroplasty')).toBeTruthy()
  })
})
