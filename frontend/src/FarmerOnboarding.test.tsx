import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FarmerOnboarding } from './FarmerOnboarding'

const mockUpdate = vi.fn()
const mockInsert = vi.fn()
const mockEq = vi.fn()
const mockFrom = vi.fn()

vi.mock('./lib/supabase', () => ({
  getSupabaseClient: () => ({
    from: mockFrom,
  }),
}))

describe('FarmerOnboarding Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockEq.mockResolvedValue({ error: null })
    mockUpdate.mockReturnValue({ eq: mockEq })
    mockInsert.mockResolvedValue({ error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { update: mockUpdate }
      }
      if (table === 'farms') {
        return { insert: mockInsert }
      }
      return {}
    })
  })

  it('renders onboarding form with initial full name and default county', () => {
    render(
      <FarmerOnboarding
        userId="user-123"
        initialName="Amina Njeri"
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Welcome to SoilSync AI' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveValue('Amina Njeri')
    expect(screen.getByLabelText('County')).toHaveValue('Nakuru')
  })

  it('validates +254 Kenyan phone number format', async () => {
    render(
      <FarmerOnboarding
        userId="user-123"
        initialName="Amina Njeri"
        onComplete={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Farm name'), { target: { value: 'Green Valley' } })
    fireEvent.change(screen.getByLabelText('Sub-County'), { target: { value: 'Njoro' } })
    fireEvent.change(screen.getByLabelText('Ward'), { target: { value: 'Mau Narok' } })
    fireEvent.change(screen.getByLabelText(/Phone number/i), { target: { value: '0712345678' } })

    fireEvent.submit(screen.getByRole('button', { name: /Complete Setup/i }).closest('form')!)

    expect(
      await screen.findByText('Phone number must be in +254 format (e.g. +254712345678).'),
    ).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('saves profile, inserts farm, and triggers onComplete on valid submission', async () => {
    const handleComplete = vi.fn()

    render(
      <FarmerOnboarding
        userId="user-123"
        initialName="Amina Njeri"
        onComplete={handleComplete}
      />,
    )

    fireEvent.change(screen.getByLabelText('Farm name'), { target: { value: 'Mau Ridge Farm' } })
    fireEvent.change(screen.getByLabelText('Sub-County'), { target: { value: 'Njoro' } })
    fireEvent.change(screen.getByLabelText('Ward'), { target: { value: 'Mau Narok' } })
    fireEvent.change(screen.getByLabelText(/Phone number/i), { target: { value: '+254712345678' } })

    fireEvent.submit(screen.getByRole('button', { name: /Complete Setup/i }).closest('form')!)

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('profiles')
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          full_name: 'Amina Njeri',
          county: 'Nakuru',
          sub_county: 'Njoro',
          ward: 'Mau Narok',
          phone_number: '+254712345678',
        }),
      )
      expect(mockEq).toHaveBeenCalledWith('id', 'user-123')
      expect(mockFrom).toHaveBeenCalledWith('farms')
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          owner_id: 'user-123',
          name: 'Mau Ridge Farm',
          county: 'Nakuru',
          sub_county: 'Njoro',
          ward: 'Mau Narok',
        }),
      )
      expect(handleComplete).toHaveBeenCalledTimes(1)
    })
  })

  it('displays error banner when profile update fails', async () => {
    mockEq.mockResolvedValue({ error: new Error('Database connection failed') })

    render(
      <FarmerOnboarding
        userId="user-123"
        initialName="Amina Njeri"
        onComplete={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Farm name'), { target: { value: 'Mau Ridge Farm' } })
    fireEvent.change(screen.getByLabelText('Sub-County'), { target: { value: 'Njoro' } })
    fireEvent.change(screen.getByLabelText('Ward'), { target: { value: 'Mau Narok' } })

    fireEvent.submit(screen.getByRole('button', { name: /Complete Setup/i }).closest('form')!)

    expect(await screen.findByRole('alert')).toHaveTextContent('Database connection failed')
  })
})
