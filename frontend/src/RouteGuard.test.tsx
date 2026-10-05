import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteGuard } from './RouteGuard'
import * as AuthContextModule from './context/AuthContext'
import type { Session, User } from '@supabase/supabase-js'

const mockSignOut = vi.fn().mockResolvedValue(undefined)
const mockRefreshRoles = vi.fn().mockResolvedValue(undefined)
const mockNavigate = vi.fn()

function createMockAuth(overrides: Partial<AuthContextModule.AuthContextValue> = {}): AuthContextModule.AuthContextValue {
  return {
    session: { access_token: 'valid-token' } as Session,
    user: { id: 'user-1', email: 'farmer@example.com', email_confirmed_at: '2026-10-01T00:00:00Z' } as User,
    profile: {
      id: 'user-1',
      fullName: 'Amina Njeri',
      county: 'Nakuru',
      subCounty: 'Njoro',
      ward: 'Mau Narok',
      phoneNumber: '+254712345678',
    },
    activeRoles: ['farmer'],
    allRoles: [{ role: 'farmer', status: 'active' }],
    isLoading: false,
    error: null,
    signInWithPassword: vi.fn(),
    signUpWithPassword: vi.fn(),
    signOut: mockSignOut,
    refreshSession: vi.fn(),
    refreshRoles: mockRefreshRoles,
    ...overrides,
  }
}

describe('RouteGuard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders children freely for public welcome destination', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({ session: null, user: null }),
    )

    render(
      <RouteGuard destination="welcome" onNavigate={mockNavigate}>
        <div>Public Welcome Content</div>
      </RouteGuard>,
    )

    expect(screen.getByText('Public Welcome Content')).toBeInTheDocument()
  })

  it('renders children freely for workshop demo destination', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({ session: null, user: null }),
    )

    render(
      <RouteGuard destination="workshop" onNavigate={mockNavigate}>
        <div>Workshop Demo Content</div>
      </RouteGuard>,
    )

    expect(screen.getByText('Workshop Demo Content')).toBeInTheDocument()
  })

  it('shows loading indicator while verifying access permissions', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({ isLoading: true }),
    )

    render(
      <RouteGuard destination="farmer" onNavigate={mockNavigate}>
        <div>Protected Farmer Workspace</div>
      </RouteGuard>,
    )

    expect(screen.getByText('Verifying access permissions…')).toBeInTheDocument()
    expect(screen.queryByText('Protected Farmer Workspace')).not.toBeInTheDocument()
  })

  it('does not render protected content when account access could not be verified', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({
        error: 'Could not load account access details.',
        activeRoles: [],
        allRoles: [],
      }),
    )

    render(
      <RouteGuard destination="farmer" onNavigate={mockNavigate}>
        <div>Protected Farmer Workspace</div>
      </RouteGuard>,
    )

    expect(screen.getByRole('heading', { name: 'Unable to verify account access' })).toBeInTheDocument()
    expect(screen.getByText('Could not load account access details.')).toBeInTheDocument()
    expect(screen.queryByText('Protected Farmer Workspace')).not.toBeInTheDocument()
  })

  it('displays sign-in prompt when accessing protected destination while signed out', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({ session: null, user: null }),
    )

    render(
      <RouteGuard destination="farmer" onNavigate={mockNavigate}>
        <div>Protected Farmer Workspace</div>
      </RouteGuard>,
    )

    expect(screen.getByRole('heading', { name: 'Sign-in Required' })).toBeInTheDocument()
    expect(screen.getByText(/You must be signed in to access the farmer workspace/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Go to Sign In' }))
    expect(mockNavigate).toHaveBeenCalledWith('/welcome')
  })

  it('allows an authenticated account to continue onboarding without email confirmation', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({
        profile: {
          id: 'user-1',
          fullName: 'Amina Njeri',
          county: null,
          subCounty: null,
          ward: null,
          phoneNumber: null,
        },
        user: { id: 'user-1', email: 'unconfirmed@example.com' } as User,
      }),
    )

    render(
      <RouteGuard destination="farmer" onNavigate={mockNavigate}>
        <div>Protected Farmer Workspace</div>
      </RouteGuard>,
    )

    expect(screen.getByRole('heading', { name: 'Welcome to SoilSync AI' })).toBeInTheDocument()
    expect(screen.getByText(/Set up your farm profile/i)).toBeInTheDocument()
  })

  it('does not treat a pending staff invitation as a farmer account', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({
        activeRoles: [],
        allRoles: [{ role: 'extension-officer', status: 'pending' }],
        profile: {
          id: 'user-1',
          fullName: 'Sarah Officer',
          county: null,
          subCounty: null,
          ward: null,
          phoneNumber: null,
        },
      }),
    )

    render(
      <RouteGuard destination="farmer" onNavigate={mockNavigate}>
        <div>Protected Farmer Workspace</div>
      </RouteGuard>,
    )

    expect(screen.getByRole('heading', { name: 'Access Restricted' })).toBeInTheDocument()
    expect(screen.queryByText(/Set up your farm profile/i)).not.toBeInTheDocument()
  })

  it('renders farmer onboarding form when farmer profile is incomplete', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({
        profile: {
          id: 'user-1',
          fullName: 'Amina Njeri',
          county: null,
          subCounty: null,
          ward: null,
          phoneNumber: null,
        },
      }),
    )

    render(
      <RouteGuard destination="farmer" onNavigate={mockNavigate}>
        <div>Protected Farmer Workspace</div>
      </RouteGuard>,
    )

    expect(screen.getByRole('heading', { name: 'Welcome to SoilSync AI' })).toBeInTheDocument()
    expect(screen.getByText(/Set up your farm profile/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Farm name')).toBeInTheDocument()
    expect(screen.queryByText('Protected Farmer Workspace')).not.toBeInTheDocument()
  })

  it('renders Access Restricted when user attempts to access an unauthorized workspace', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({
        activeRoles: ['farmer'],
        allRoles: [{ role: 'farmer', status: 'active' }],
      }),
    )

    render(
      <RouteGuard destination="admin" onNavigate={mockNavigate}>
        <div>Protected Admin Workspace</div>
      </RouteGuard>,
    )

    expect(screen.getByRole('heading', { name: 'Access Restricted' })).toBeInTheDocument()
    expect(
      screen.getByText(/You do not have active permissions to access the Administrator workspace/i),
    ).toBeInTheDocument()

    const returnButton = screen.getByRole('button', { name: /Return to Farmer Workspace/i })
    fireEvent.click(returnButton)
    expect(mockNavigate).toHaveBeenCalledWith('/farmer')
  })

  it('directs agrodealer access requests to an administrator instead of offering self-application', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({
        activeRoles: ['farmer'],
        allRoles: [{ role: 'farmer', status: 'active' }],
      }),
    )

    render(
      <RouteGuard destination="dealer" onNavigate={mockNavigate}>
        <div>Protected Dealer Workspace</div>
      </RouteGuard>,
    )

    expect(screen.getByText(/Agrodealer accounts are created by an administrator/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Apply to Become an Agrodealer/i })).not.toBeInTheDocument()
  })

  it('renders Application Under Review when user role is in pending status', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({
        activeRoles: ['farmer'],
        allRoles: [
          { role: 'farmer', status: 'active' },
          { role: 'agrodealer', status: 'pending' },
        ],
      }),
    )

    render(
      <RouteGuard destination="dealer" onNavigate={mockNavigate}>
        <div>Protected Dealer Workspace</div>
      </RouteGuard>,
    )

    expect(screen.getByRole('heading', { name: /Dealer Application Pending Approval/i })).toBeInTheDocument()
    expect(screen.getByText('Application Under Review')).toBeInTheDocument()
    expect(
      screen.getByText(/must review and verify your business licence/i),
    ).toBeInTheDocument()

    const returnButton = screen.getByRole('button', { name: /Return to Farmer Workspace/i })
    fireEvent.click(returnButton)
    expect(mockNavigate).toHaveBeenCalledWith('/farmer')
  })

  it('renders children when user is authenticated, verified, onboarded, and authorized', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      createMockAuth({
        activeRoles: ['farmer'],
      }),
    )

    render(
      <RouteGuard destination="farmer" onNavigate={mockNavigate}>
        <div>Protected Farmer Workspace Content</div>
      </RouteGuard>,
    )

    expect(screen.getByText('Protected Farmer Workspace Content')).toBeInTheDocument()
  })
})
