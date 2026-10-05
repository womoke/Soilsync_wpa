import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminAccount from './AdminAccount'
import ExtensionOfficerAccount from './ExtensionOfficerAccount'
import * as adminApi from './api/admin'
import * as officerApi from './api/officer'

const { getClient } = vi.hoisted(() => ({ getClient: vi.fn().mockReturnValue(null) }))
vi.mock('./lib/supabase', () => ({ getSupabaseClient: getClient }))

vi.mock('./api/admin', () => ({
  getAdminOverview: vi.fn(),
  getAdminUsers: vi.fn(),
  getAdminOperationalHealth: vi.fn(),
  getSupportAccessGrants: vi.fn(),
  getAdminSettings: vi.fn(),
  getAdminAuditLog: vi.fn(),
  getAdminPermissions: vi.fn(),
  inviteOfficer: vi.fn(),
  inviteAgrodealer: vi.fn(),
  inviteAgronomist: vi.fn(),
  approveAdminUser: vi.fn(),
  updateAgronomistApproval: vi.fn(),
  resendInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  triggerUnclaimedReminders: vi.fn(),
  triggerUnclaimedCleanup: vi.fn(),
  revokeAdminUser: vi.fn(),
  updateAdminUserRole: vi.fn(),
  toggleAdminUserActive: vi.fn(),
  grantSupportAccess: vi.fn(),
  revokeSupportAccess: vi.fn(),
  viewSensitiveRecord: vi.fn(),
  updateAdminSetting: vi.fn(),
}))

vi.mock('./api/officer', () => ({
  getOfficerJurisdictions: vi.fn(),
  getOfficerFarmerRoster: vi.fn(),
  getOfficerVisits: vi.fn(),
  getOfficerVisitPool: vi.fn(),
  claimOfficerVisit: vi.fn(),
  releaseOfficerVisit: vi.fn(),
  scheduleOfficerVisit: vi.fn(),
  updateOfficerVisit: vi.fn(),
  getOfficerAlerts: vi.fn(),
  createOfficerAlert: vi.fn(),
  triageOfficerAlert: vi.fn(),
  getOfficerWardSummaries: vi.fn(),
  fetchUnclaimedFarmers: vi.fn(),
  registerUnclaimedFarmer: vi.fn(),
  exportOfficerReport: vi.fn(),
  recordOfficerFieldCollection: vi.fn(),
  getUnverifiedAssessments: vi.fn(),
  claimAssessment: vi.fn(),
  releaseAssessment: vi.fn(),
  editAssessment: vi.fn(),
  publishAssessment: vi.fn(),
}))

describe('Phase 1: Identity and Account Lifecycle Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Admin default mocks
    vi.mocked(adminApi.getAdminOverview).mockResolvedValue({
      totalUsers: 15,
      activeUsers: 12,
      pendingApprovals: 3,
      roleBreakdown: {
        farmers: 10,
        extensionOfficers: 2,
        agrodealers: 2,
        admins: 1,
      },
      totalFarms: 20,
      totalSoilReadings: 50,
      syncOverview: {
        pending: 1,
        draft: 2,
        failed: 0,
        conflict: 0,
      },
      unresolvedAlerts: 1,
      activeSupportGrants: 0,
    } as any)
    vi.mocked(adminApi.getAdminPermissions).mockResolvedValue([])
    vi.mocked(adminApi.getAdminUsers).mockResolvedValue([
      {
        userId: 'agro-1',
        email: 'agronomist@kalro.org',
        displayName: 'Dr. Jane Muthoni',
        role: 'agronomist',
        approvalStatus: 'pending',
        isActive: true,
        createdAt: '2026-10-01T08:00:00Z',
        phone: null,
        approvedAt: null,
        suspendedAt: null,
        revocationReason: null,
      },
      {
        userId: 'farmer-unclaimed-1',
        email: 'unclaimed.farmer@example.com',
        displayName: 'Peter Njoroge',
        role: 'farmer',
        approvalStatus: 'unclaimed',
        isActive: true,
        createdAt: '2026-10-02T10:00:00Z',
        phone: null,
        approvedAt: null,
        suspendedAt: null,
        revocationReason: null,
      },
    ])

    // Officer default mocks
    vi.mocked(officerApi.getOfficerJurisdictions).mockResolvedValue([
      {
        assignmentId: 'assign-1',
        county: 'Nakuru',
        subCounty: 'Njoro',
        ward: 'Mau Narok',
        assignedAt: '2026-09-01T08:00:00Z',
      },
    ])
    vi.mocked(officerApi.getOfficerFarmerRoster).mockResolvedValue([])
    vi.mocked(officerApi.getOfficerVisits).mockResolvedValue([])
    vi.mocked(officerApi.getOfficerVisitPool).mockResolvedValue([])
    vi.mocked(officerApi.getOfficerAlerts).mockResolvedValue([])
    vi.mocked(officerApi.getOfficerWardSummaries).mockResolvedValue([])
    vi.mocked(officerApi.getUnverifiedAssessments).mockResolvedValue([])
    vi.mocked(officerApi.fetchUnclaimedFarmers).mockResolvedValue([
      {
        authUserId: 'auth-user-99',
        farmerUserId: 'farmer-user-99',
        fullName: 'Peter Njoroge',
        email: 'peter.njoroge@example.com',
        initialFarmId: 'farm-99',
        initialFarmName: 'Mau Narok Highland Farm',
        county: 'Nakuru',
        status: 'unclaimed',
        reminderCount: 2,
        lastReminderAt: '2026-10-03T08:00:00Z',
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        daysUntilExpiration: 5,
      },
    ])
  })

  it('admin opens Invite Agronomist modal and provisions a new licensed agronomist', async () => {
    vi.mocked(adminApi.inviteAgronomist).mockResolvedValue({
      status: 'pending',
      agronomistUserId: 'agro-new',
      email: 'dr.kamau@field.org',
      licenceNumber: 'AGR-KE-2024-991',
      county: 'Nakuru',
      role: 'agronomist',
      approvalStatus: 'pending',
      invitedAt: new Date().toISOString(),
    })

    render(<AdminAccount onBackToDemo={vi.fn()} />)

    // Sign in with manual admin token
    fireEvent.change(screen.getByPlaceholderText('Paste Bearer token here'), {
      target: { value: 'test-admin-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

    // Switch to Accounts & Roles tab
    await waitFor(() => {
      expect(screen.getByText('Accounts & Roles')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Accounts & Roles'))

    // Click Invite Agronomist
    await waitFor(() => {
      expect(screen.getByText('Invite Agronomist')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Invite Agronomist'))

    // Fill the Agronomist Invitation form
    expect(screen.getByLabelText(/Licence \/ Registration Number/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Email \*/i), {
      target: { value: 'dr.kamau@field.org' },
    })
    fireEvent.change(screen.getByLabelText(/Full Name \*/i), {
      target: { value: 'Dr. Peter Kamau' },
    })
    fireEvent.change(screen.getByLabelText(/Licence \/ Registration Number \*/i), {
      target: { value: 'AGR-KE-2024-991' },
    })

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitation' }))

    await waitFor(() => {
      expect(adminApi.inviteAgronomist).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'dr.kamau@field.org',
          display_name: 'Dr. Peter Kamau',
          licence_number: 'AGR-KE-2024-991',
          approval_status: 'pending',
        }),
        'test-admin-token',
      )
    })
  })

  it('admin can resend and cancel pending/unclaimed invitations', async () => {
    vi.mocked(adminApi.resendInvitation).mockResolvedValue({
      authUserId: 'agro-1',
      action: 'resent',
      status: 'resent',
      message: 'Invitation resent to agronomist@kalro.org.',
    })
    vi.mocked(adminApi.cancelInvitation).mockResolvedValue({
      authUserId: 'farmer-unclaimed-1',
      action: 'cancelled',
      status: 'cancelled',
      message: 'Invitation for unclaimed.farmer@example.com cancelled.',
    })

    render(<AdminAccount onBackToDemo={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Paste Bearer token here'), {
      target: { value: 'test-admin-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

    await waitFor(() => {
      fireEvent.click(screen.getByText('Accounts & Roles'))
    })

    // Expect Resend and Cancel buttons for pending/unclaimed accounts
    await waitFor(() => {
      const resendButtons = screen.getAllByRole('button', { name: /Resend/i })
      expect(resendButtons.length).toBeGreaterThan(0)
    })

    // Resend invite
    const resendButtons = screen.getAllByRole('button', { name: /Resend/i })
    fireEvent.click(resendButtons[0])

    await waitFor(() => {
      expect(adminApi.resendInvitation).toHaveBeenCalledWith('agro-1', 'test-admin-token')
    })

    // Cancel invite
    const cancelButtons = screen.getAllByRole('button', { name: /Cancel/i })
    fireEvent.click(cancelButtons[1])

    await waitFor(() => {
      expect(adminApi.cancelInvitation).toHaveBeenCalledWith('farmer-unclaimed-1', 'test-admin-token')
    })
  })

  it('admin can trigger Day 1-6 reminders and Day 7 cleanup batch jobs', async () => {
    vi.mocked(adminApi.triggerUnclaimedReminders).mockResolvedValue({
      processedCount: 5,
      remindersSent: 4,
      message: 'Batch completed: 4 reminder(s) sent.',
    })
    vi.mocked(adminApi.triggerUnclaimedCleanup).mockResolvedValue({
      processedCount: 2,
      expiredAndDeleted: 2,
      message: 'Cascade cleanup completed: 2 expired account(s) deleted.',
    })

    render(<AdminAccount onBackToDemo={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Paste Bearer token here'), {
      target: { value: 'test-admin-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

    await waitFor(() => {
      fireEvent.click(screen.getByText('Accounts & Roles'))
    })

    // Trigger Day 1-6 Reminders
    await waitFor(() => {
      expect(screen.getByText(/Trigger Day 1–6 Reminders/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(/Trigger Day 1–6 Reminders/i))

    await waitFor(() => {
      expect(adminApi.triggerUnclaimedReminders).toHaveBeenCalledWith('test-admin-token')
      expect(screen.getByText(/4 reminder\(s\) sent/i)).toBeInTheDocument()
    })

    // Trigger Day 7 Cleanup
    fireEvent.click(screen.getByText(/Trigger Day 7 Cleanup/i))

    await waitFor(() => {
      expect(adminApi.triggerUnclaimedCleanup).toHaveBeenCalledWith('test-admin-token')
      expect(screen.getByText(/2 expired account\(s\) deleted/i)).toBeInTheDocument()
    })
  })

  it('extension officer registers farmer on-site and views unclaimed roster with Day 7 countdown', async () => {
    vi.mocked(officerApi.registerUnclaimedFarmer).mockResolvedValue({
      authUserId: 'auth-user-new',
      farmerUserId: 'farmer-user-new',
      email: 'muthoni.farmer@example.com',
      fullName: 'Grace Muthoni',
      initialFarmId: 'farm-new',
      status: 'unclaimed',
      role: 'farmer',
      registeredAt: new Date().toISOString(),
      message: 'On-site registration complete',
    })

    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('valid-officer-token'), {
      target: { value: 'test-officer-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

    // Switch to Unclaimed tab
    await waitFor(() => {
      expect(screen.getByText(/Unclaimed On-Site Registrations/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(/Unclaimed On-Site Registrations/i))

    // Expect Peter Njoroge and Day 7 Deletion countdown badge
    await waitFor(() => {
      expect(screen.getByText('Peter Njoroge')).toBeInTheDocument()
      expect(screen.getByText(/Day 7 Deletion: 5d left/i)).toBeInTheDocument()
      expect(screen.getByText(/2 \/ 6 Reminders/i)).toBeInTheDocument()
    })

    // Open Register Farmer On-Site modal
    fireEvent.click(screen.getByRole('button', { name: /Register Farmer On-Site/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/Farmer Email Address \*/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/Farmer Email Address \*/i), {
      target: { value: 'muthoni.farmer@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/Full Name \*/i), {
      target: { value: 'Grace Muthoni' },
    })
    fireEvent.change(screen.getByLabelText(/Initial Farm Name \*/i), {
      target: { value: 'Muthoni Maize Farm' },
    })
    fireEvent.change(screen.getByLabelText(/^County \*/i), {
      target: { value: 'Nakuru' },
    })
    fireEvent.change(screen.getByLabelText(/Sub-County \*/i), {
      target: { value: 'Njoro' },
    })
    fireEvent.change(screen.getByLabelText(/Ward \*/i), {
      target: { value: 'Mau Narok' },
    })

    // Submit on-site registration
    fireEvent.click(screen.getByRole('button', { name: /Register & Send Claim Link/i }))

    await waitFor(() => {
      expect(officerApi.registerUnclaimedFarmer).toHaveBeenCalledWith(
        'test-officer-token',
        expect.objectContaining({
          email: 'muthoni.farmer@example.com',
          fullName: 'Grace Muthoni',
          farmName: 'Muthoni Maize Farm',
          county: 'Nakuru',
          subCounty: 'Njoro',
          ward: 'Mau Narok',
        }),
      )
    })
  })
})
