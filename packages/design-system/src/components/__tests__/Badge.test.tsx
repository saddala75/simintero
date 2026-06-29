import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from '../Badge'

describe('Badge Component', () => {
  test('renders rule badge with monospaced font class and label', () => {
    render(<Badge variant="rule" label="HIPAA-270" />)
    const el = screen.getByText('HIPAA-270')
    expect(el).toBeTruthy()
    expect(el.getAttribute('data-variant')).toBe('rule')
    expect(el.className).toContain('font-mono')
  })

  test('renders status badge for approved status with label', () => {
    render(<Badge variant="status" status="approved" />)
    const el = screen.getByText('Approved')
    expect(el).toBeTruthy()
    expect(el.getAttribute('data-variant')).toBe('status')
  })

  test('renders status badge for denied status with label', () => {
    render(<Badge variant="status" status="denied" />)
    const el = screen.getByText('Denied')
    expect(el).toBeTruthy()
  })
})
