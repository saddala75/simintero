import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card, EvidenceCard } from '../Card'

describe('Card Components', () => {
  test('renders container Card with children', () => {
    render(<Card>Card Content</Card>)
    expect(screen.getByText('Card Content')).toBeTruthy()
  })

  test('renders EvidenceCard with confidence and citations', () => {
    render(
      <EvidenceCard
        title="Physical Therapy Recommended"
        confidence={0.92}
        citationCount={3}
        onAccept={() => {}}
        onReject={() => {}}
      />
    )
    expect(screen.getByText('Physical Therapy Recommended')).toBeTruthy()
    expect(screen.getByText('92% confidence')).toBeTruthy()
    expect(screen.getByText('3 citations')).toBeTruthy()
  })
})
