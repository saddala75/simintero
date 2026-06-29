import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../Button'

describe('Button Component', () => {
  test('renders primary button by default with children', () => {
    render(<Button>Click Me</Button>)
    const button = screen.getByRole('button', { name: 'Click Me' })
    expect(button).toBeTruthy()
    expect(button.getAttribute('data-variant')).toBe('primary')
  })

  test('renders ai variant button', () => {
    render(<Button variant="ai">AI Analysis</Button>)
    const button = screen.getByRole('button', { name: 'AI Analysis' })
    expect(button.getAttribute('data-variant')).toBe('ai')
  })

  test('disables button when loading is true', () => {
    render(<Button loading>Submitting</Button>)
    const button = screen.getByRole('button')
    expect(button.hasAttribute('disabled')).toBe(true)
  })
})
