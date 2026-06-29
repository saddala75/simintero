import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SlaIndicator } from '../SlaIndicator'
import { Timeline } from '../Timeline'
import { DataTable } from '../DataTable'

describe('Indicators, Timeline & DataTable Components', () => {
  test('renders SlaIndicator with remaining hours', () => {
    render(<SlaIndicator hoursRemaining={12} totalHours={72} />)
    expect(screen.getByText('12h')).toBeTruthy()
  })

  test('renders SlaIndicator breached state', () => {
    render(<SlaIndicator hoursRemaining={0} totalHours={72} breached />)
    expect(screen.getByText('BREACHED')).toBeTruthy()
  })

  test('renders Timeline with items', () => {
    const items = [
      { id: '1', title: 'Case Created', timestamp: '2026-06-28 10:00' },
      { id: '2', title: 'Adverse Decision', timestamp: '2026-06-28 12:00' },
    ]
    render(<Timeline items={items} />)
    expect(screen.getByText('Case Created')).toBeTruthy()
    expect(screen.getByText('Adverse Decision')).toBeTruthy()
  })

  test('renders DataTable with columns and data rows', () => {
    const columns = [
      { key: 'id', header: 'ID' },
      { key: 'name', header: 'Name' },
    ]
    const data = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]
    render(<DataTable columns={columns} data={data} keyExtractor={(item) => item.id} />)
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
  })
})
