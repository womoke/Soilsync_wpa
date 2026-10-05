import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminAccount from './AdminAccount'

const { getClient, linkAccount } = vi.hoisted(() => ({
  getClient: vi.fn().mockReturnValue(null),
  linkAccount: vi.fn(),
}))
vi.mock('./lib/supabase', () => ({ getSupabaseClient: getClient }))
vi.mock('./api/auth', () => ({ linkAuthenticatedAccount: linkAccount }))

const mockOverview = {
  totalUsers: 42,
  activeUsers: 38,
  pendingApprovals: 3,
  roleBreakdown: {
    farmers: 28,
    extensionOfficers: 6,
    agrodealers: 6,
    admins: 2,
  },
  totalFarms: 35,
  totalSoilReadings: 120,
  syncOverview: {
    pending: 2,
    draft: 5,
    failed: 1,
    conflict: 0,
  },
  unresolvedAlerts: 4,
  activeSupportGrants: 1,
}

const mockPermissions = [
  { id: 'p1', permission: 'manage_accounts', expiresAt: null, isActive: true },
  { id: 'p2', permission: 'manage_roles', expiresAt: null, isActive: true },
  { id: 'p3', permission: 'support_access', expiresAt: null, isActive: true },
  { id: 'p4', permission: 'manage_settings', expiresAt: null, isActive: true },
]

const mockUsers = [
  {
    userId: 'u-1',
    displayName: 'Amina Njeri',
    email: 'amina.njeri@example.com',
    phone: '+254711000111',
    role: 'farmer',
    isActive: true,
    approvalStatus: 'approved',
    approvedAt: '2026-10-01T08:00:00Z',
    revocationReason: null,
    suspendedAt: null,
    createdAt: '2026-10-01T08:00:00Z',
  },
  {
    userId: 'u-2',
    displayName: 'Sarah Officer',
    email: 'sarah.officer@example.com',
    phone: null,
    role: 'extension_officer',
    isActive: true,
    approvalStatus: 'pending',
    approvedAt: null,
    revocationReason: null,
    suspendedAt: null,
    createdAt: '2026-10-02T09:00:00Z',
  },
  {
    userId: 'u-3',
    displayName: 'Mwangi Agrovets',
    email: 'mwangi@agrovet.test',
    phone: null,
    role: 'agrodealer',
    isActive: false,
    approvalStatus: 'suspended',
    approvedAt: null,
    revocationReason: 'Uncertified fertilizer batch flagged during audit',
    suspendedAt: '2026-10-02T10:00:00Z',
    createdAt: '2026-09-15T08:00:00Z',
  },
]

const mockHealth = {
  status: 'operational',
  checkedAt: '2026-10-02T12:00:00Z',
  database: {
    status: 'connected',
    engine: 'PostgreSQL 16 (PostGIS)',
    poolStatus: 'healthy',
  },
  syncSubsystem: {
    failedDraftsCount: 1,
    conflictDraftsCount: 0,
    privacySafeguard:
      'Sync issue metrics are strictly anonymized. No farmer identifiers, phone numbers, or coordinates are exposed.',
  },
  importBatches: [
    {
      batchId: 'b-001',
      datasetKey: 'isric_wosis_2024',
      datasetTitle: 'WoSIS Standardized Profiles',
      fileName: 'wosis_ke_2024.parquet',
      status: 'completed',
      rowsRead: 500,
      rowsImported: 495,
      rowsRejected: 5,
      startedAt: '2026-10-01T04:00:00Z',
      completedAt: '2026-10-01T04:05:00Z',
    },
  ],
  externalProviders: [
    {
      provider: 'ISRIC_SOILGRIDS',
      label: 'SoilGrids REST & WCS',
      status: 'healthy',
      description: 'Global gridded soil property layers at 250m resolution.',
    },
    {
      provider: 'SUPABASE_AUTH',
      label: 'Supabase Identity & Auth',
      status: 'healthy',
      description: 'JWT-based session authentication and cryptographic verification.',
    },
  ],
}

const mockSupportGrants = [
  {
    grantId: 'grant-001',
    adminUserId: 'admin-lead-1',
    adminName: 'Lead Admin',
    adminEmail: 'admin@soilsync.test',
    targetType: 'farm',
    targetId: 'farm-123-uuid',
    reason: 'Investigating farmer report of divergent nitrogen recommendations',
    durationMinutes: 60,
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    isRevoked: false,
    revokedAt: null,
    revocationReason: null,
    accessCount: 1,
    lastAccessedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
]

const mockSettings = [
  {
    settingId: 's-1',
    key: 'security.support_access_max_duration_minutes',
    value: 120,
    category: 'security',
    description: 'Maximum duration allowed for break-glass support grants.',
    isReadOnly: false,
    updatedByName: 'Lead Admin',
    updatedAt: '2026-10-01T08:00:00Z',
  },
  {
    settingId: 's-2',
    key: 'sync.max_batch_size',
    value: 50,
    category: 'sync',
    description: 'Maximum draft batch size during sync.',
    isReadOnly: false,
    updatedByName: 'Lead Admin',
    updatedAt: '2026-10-01T08:00:00Z',
  },
]

const mockAuditLogs = [
  {
    id: 'log-001',
    actorUserId: 'admin-lead-1',
    actorRole: 'admin',
    action: 'approve_user',
    targetType: 'user',
    targetId: 'u-1',
    detail: { notes: 'Verified credentials' },
    ipAddress: '192.168.1.1',
    createdAt: '2026-10-02T11:00:00Z',
  },
]

describe('AdminAccount Component - Section 6 Admin Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getClient.mockReturnValue(null)
    linkAccount.mockReset()

    globalThis.fetch = vi
      .fn()
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method || 'GET'

        if (url.includes('/api/v1/admin/overview')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockOverview),
          })
        }
        if (url.includes('/api/v1/admin/permissions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockPermissions),
          })
        }
        if (url.includes('/api/v1/admin/users') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockUsers),
          })
        }
        if (url.includes('/api/v1/admin/users/') && url.includes('/approve') && method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                userId: 'u-2',
                displayName: 'Sarah Officer',
                email: 'sarah.officer@example.com',
                role: 'extension_officer',
                isActive: true,
                approvalStatus: 'approved',
                approvedAt: '2026-10-02T12:00:00Z',
              }),
          })
        }
        if (url.includes('/api/v1/admin/users/') && url.includes('/revoke') && method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                userId: 'u-1',
                displayName: 'Amina Njeri',
                email: 'amina.njeri@example.com',
                role: 'farmer',
                isActive: false,
                approvalStatus: 'suspended',
                suspendedAt: '2026-10-02T12:00:00Z',
                revocationReason: 'Suspended for test',
              }),
          })
        }
        if (url.includes('/api/v1/admin/officers/invite') && method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                officerUserId: 'u-officer-new',
                assignmentId: 'asgn-new',
                email: 'invited.officer@example.com',
                designation: 'ward',
                county: 'Nakuru',
                subCounty: 'Njoro',
                ward: 'Mau Narok',
                role: 'extension_officer',
                status: 'pending',
                invitedAt: '2026-10-03T00:00:00Z',
              }),
          })
        }
        if (url.includes('/api/v1/admin/users/') && url.includes('/role') && method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                userId: 'u-1',
                displayName: 'Amina Njeri',
                role: 'extension_officer',
                isActive: true,
              }),
          })
        }
        if (url.includes('/api/v1/admin/users/') && url.includes('/active') && method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                userId: 'u-1',
                displayName: 'Amina Njeri',
                role: 'farmer',
                isActive: false,
              }),
          })
        }
        if (url.includes('/api/v1/admin/operational-health')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockHealth),
          })
        }
        if (url.includes('/api/v1/admin/support-access/grants') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockSupportGrants),
          })
        }
        if (url.includes('/api/v1/admin/support-access/grants') && method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                grantId: 'grant-new-999',
                adminUserId: 'admin-lead-1',
                targetType: 'farm',
                targetId: 'farm-test-1',
                reason: 'Customer reported invalid pH recommendation',
                durationMinutes: 30,
                expiresAt: new Date(Date.now() + 1800000).toISOString(),
                isRevoked: false,
                accessCount: 0,
                createdAt: new Date().toISOString(),
              }),
          })
        }
        if (
          url.includes('/api/v1/admin/support-access/grants/') &&
          url.includes('/revoke') &&
          method === 'POST'
        ) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                grantId: 'grant-001',
                isRevoked: true,
                revocationReason: 'Investigation complete',
              }),
          })
        }
        if (url.includes('/api/v1/admin/support-access/records/')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                grantId: 'grant-001',
                targetType: 'farm',
                targetId: 'farm-123-uuid',
                accessReason: 'Investigating nitrogen',
                accessedAt: new Date().toISOString(),
                record: {
                  farmId: 'farm-123-uuid',
                  farmName: 'Highland Orchard',
                  county: 'Nyeri',
                  ward: 'Dedan Kimathi',
                },
              }),
          })
        }
        if (url.includes('/api/v1/admin/settings') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockSettings),
          })
        }
        if (url.includes('/api/v1/admin/settings/') && method === 'PUT') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                settingId: 's-2',
                key: 'sync.max_batch_size',
                value: 100,
                category: 'sync',
                description: 'Maximum draft batch size during sync.',
                isReadOnly: false,
                updatedAt: new Date().toISOString(),
              }),
          })
        }
        if (url.includes('/api/v1/admin/audit-log')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockAuditLogs),
          })
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        })
      }) as unknown as typeof fetch
  })

  it('renders admin workspace with live overview metrics from database (Item 85)', async () => {
    render(<AdminAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Paste Bearer token here/i)
    fireEvent.change(tokenInput, { target: { value: 'test-admin-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

    expect(screen.getByText('System Admin Workspace')).toBeInTheDocument()
    expect(await screen.findByText('Registered Users')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('35 Farms')).toBeInTheDocument()
    expect(screen.getByText('120 validated soil readings')).toBeInTheDocument()
    expect(screen.getByText('2 Queued')).toBeInTheDocument()
    expect(screen.getByText('Farmers')).toBeInTheDocument()
    expect(screen.getByText('28')).toBeInTheDocument()
  })

  it('links a restored Supabase session and checks the server-assigned admin role', async () => {
    const session = { access_token: 'verified-admin-token' }
    const signOut = vi.fn().mockResolvedValue({ error: null })
    getClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session } }),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        signOut,
      },
    })
    linkAccount.mockResolvedValue({
      status: 'linked',
      appUserId: 'admin-1',
      identityProvider: 'supabase',
      role: 'admin',
    })

    render(<AdminAccount onBackToDemo={vi.fn()} />)

    expect(await screen.findByText('Registered Users')).toBeInTheDocument()
    expect(linkAccount).toHaveBeenCalledWith('verified-admin-token')
    expect(signOut).not.toHaveBeenCalled()
  })

  it('signs out and withholds admin data when the linked account has another role', async () => {
    const session = { access_token: 'verified-farmer-token' }
    const signOut = vi.fn().mockResolvedValue({ error: null })
    getClient.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session } }),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        signOut,
      },
    })
    linkAccount.mockResolvedValue({
      status: 'linked',
      appUserId: 'farmer-1',
      identityProvider: 'supabase',
      role: 'farmer',
    })

    render(<AdminAccount onBackToDemo={vi.fn()} />)

    expect(
      await screen.findByText('This account has the farmer role, not the admin role.'),
    ).toBeInTheDocument()
    expect(signOut).toHaveBeenCalledOnce()
    expect(screen.queryByText('Registered Users')).not.toBeInTheDocument()
  })

  it('navigates to accounts tab and performs audited approval and revocation (Item 86)', async () => {
    render(<AdminAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Paste Bearer token here/i)
    fireEvent.change(tokenInput, { target: { value: 'test-admin-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

    fireEvent.click(await screen.findByRole('button', { name: /Accounts & Roles/i }))

    expect(await screen.findByText('Account Lifecycle & Role Governance')).toBeInTheDocument()
    expect(screen.getByText('Amina Njeri')).toBeInTheDocument()
    expect(screen.getByText('Sarah Officer')).toBeInTheDocument()
    expect(screen.getByText('Mwangi Agrovets')).toBeInTheDocument()

    // 1. Approve pending user Sarah
    const approveBtns = screen.getAllByRole('button', { name: /Approve/i })
    fireEvent.click(approveBtns[0])

    expect(screen.getByText(/Approve Account: sarah.officer@example.com/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Confirm Approval/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/Account sarah.officer@example.com approved successfully/i),
      ).toBeInTheDocument()
    })

    // 2. Suspend user Amina
    const suspendBtns = screen.getAllByRole('button', { name: /Suspend/i })
    fireEvent.click(suspendBtns[0])

    expect(screen.getByText(/Suspend Account: amina.njeri@example.com/i)).toBeInTheDocument()
    const reasonInput = screen.getByLabelText(/Reason for Suspension/i)
    fireEvent.change(reasonInput, { target: { value: 'Violation of data terms' } })
    fireEvent.click(screen.getByRole('button', { name: /Suspend Account/i }))

    await waitFor(() => {
      expect(screen.getByText(/has been suspended with logged justification/i)).toBeInTheDocument()
    })
  })

  it('navigates to operational health tab and verifies privacy safeguards (Item 87)', async () => {
    render(<AdminAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Paste Bearer token here/i)
    fireEvent.change(tokenInput, { target: { value: 'test-admin-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

    fireEvent.click(await screen.findByRole('button', { name: /Operational Health/i }))

    expect(await screen.findByText('Operational Health & Ingestion Pipeline')).toBeInTheDocument()
    expect(screen.getByText('PostgreSQL 16 (PostGIS)')).toBeInTheDocument()
    expect(screen.getByText('SoilGrids REST & WCS')).toBeInTheDocument()
    expect(screen.getByText('WoSIS Standardized Profiles')).toBeInTheDocument()

    // Verify privacy safeguard notice is explicitly displayed
    expect(
      screen.getByText(/Sync issue metrics are strictly anonymized\. No farmer identifiers/i),
    ).toBeInTheDocument()
  })

  it('manages time-limited break-glass support access and records inspection (Item 88)', async () => {
    render(<AdminAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Paste Bearer token here/i)
    fireEvent.change(tokenInput, { target: { value: 'test-admin-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

    fireEvent.click(await screen.findByRole('button', { name: /Support Access/i }))

    expect(await screen.findByText('Break-Glass Support Protocol')).toBeInTheDocument()
    expect(screen.getByText(/farm-123-uuid/i)).toBeInTheDocument()

    // 1. Inspect sensitive record under active grant
    const viewRecordBtn = screen.getByRole('button', { name: /View Record/i })
    fireEvent.click(viewRecordBtn)

    expect(await screen.findByText('Sensitive Record Inspection')).toBeInTheDocument()
    expect(screen.getByText(/Highland Orchard/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Close Record/i }))

    // 2. Request new support access grant
    fireEvent.click(screen.getByRole('button', { name: /\+ Request Support Access/i }))
    expect(screen.getByText('Request Break-Glass Support Access')).toBeInTheDocument()

    const targetIdInput = screen.getByLabelText(/Target ID/i)
    fireEvent.change(targetIdInput, { target: { value: 'farm-target-test' } })

    const reasonInput = screen.getByLabelText(/Justification Reason/i)
    fireEvent.change(reasonInput, {
      target: { value: 'Farmer reported incorrect fertilizer recommendation on farm survey' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Authorize Support Grant/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/Break-glass support access granted for 30 minutes/i),
      ).toBeInTheDocument()
    })
  })

  it('configures system settings with change reason and displays audit trail (Item 89)', async () => {
    render(<AdminAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Paste Bearer token here/i)
    fireEvent.change(tokenInput, { target: { value: 'test-admin-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

    // 1. Settings tab
    fireEvent.click(await screen.findByRole('button', { name: /System Settings/i }))
    expect(await screen.findByText('System Configuration & Parameters')).toBeInTheDocument()
    expect(screen.getByText('sync.max_batch_size')).toBeInTheDocument()

    // Click edit on the setting
    const editBtns = screen.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(editBtns[1]) // sync.max_batch_size

    expect(screen.getByText(/Update Setting: sync\.max_batch_size/i)).toBeInTheDocument()
    const valInput = screen.getByLabelText(/Parameter Value/i)
    fireEvent.change(valInput, { target: { value: '100' } })
    const reasonInput = screen.getByLabelText(/Change Justification/i)
    fireEvent.change(reasonInput, { target: { value: 'Increase capacity for planting peak' } })

    fireEvent.click(screen.getByRole('button', { name: /Save & Audit/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/Configuration setting sync\.max_batch_size updated/i),
      ).toBeInTheDocument()
    })

    // 2. Audit Trail tab
    fireEvent.click(screen.getByRole('button', { name: /Audit Trail/i }))
    expect(await screen.findByText('Privileged Actions Audit Log')).toBeInTheDocument()
    expect(screen.getByText('approve_user')).toBeInTheDocument()
  })

  it('opens invite officer modal and submits extension officer invitation', async () => {
    render(<AdminAccount onBackToDemo={vi.fn()} />)

    // Authenticate
    const tokenInput = screen.getByPlaceholderText(/Paste Bearer token here/i)
    fireEvent.change(tokenInput, { target: { value: 'test-admin-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

    // Navigate to Users tab
    fireEvent.click(await screen.findByRole('button', { name: /Accounts & Roles/i }))
    expect(await screen.findByText('Account Lifecycle & Role Governance')).toBeInTheDocument()

    // Click "Invite Officer" button
    const inviteBtn = await screen.findByRole('button', { name: /Invite Officer/i })
    fireEvent.click(inviteBtn)

    // Modal is open
    expect(screen.getByText('Invite Extension Officer')).toBeInTheDocument()

    // Fill form
    fireEvent.change(screen.getByLabelText(/Officer Email \*/i), {
      target: { value: 'invited.officer@example.com' },
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

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: /Send Invitation/i }))

    // Success message
    await waitFor(() => {
      expect(
        screen.getByText(/Invitation sent to invited\.officer@example\.com/i),
      ).toBeInTheDocument()
    })
  })

  it('invites an agrodealer with a seeded business profile', async () => {
    render(<AdminAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Paste.*here/i)
    fireEvent.change(tokenInput, { target: { value: 'test-admin-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))
    fireEvent.click(await screen.findByRole('button', { name: /Accounts & Roles/i }))

    fireEvent.click(await screen.findByRole('button', { name: /Invite Agrodealer/i }))
    fireEvent.change(screen.getByLabelText('Email *'), {
      target: { value: 'new.dealer@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Contact Name *'), {
      target: { value: 'Mary Dealer' },
    })
    fireEvent.change(screen.getByLabelText('Business Name *'), {
      target: { value: 'Green Valley Agrovet' },
    })
    fireEvent.change(screen.getByLabelText('County (optional)'), {
      target: { value: 'Nakuru' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Send Invitation/i }))
    expect(
      await screen.findByText(/Invitation sent to new\.dealer@example\.com/i),
    ).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/admin/agrodealer/invite',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'new.dealer@example.com',
          displayName: 'Mary Dealer',
          businessName: 'Green Valley Agrovet',
          county: 'Nakuru',
          subCounty: null,
          ward: null,
        }),
      }),
    )
  })

  it('prompts for administrator re-authentication before executing sensitive role changes when session is active', async () => {
    const signInWithPasswordMock = vi.fn().mockResolvedValue({ error: null })
    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: 'valid-admin-session-token',
              user: { email: 'superadmin@soilsync.ke' },
            },
          },
        }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
        signInWithPassword: signInWithPasswordMock,
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    }
    getClient.mockReturnValue(mockSupabase)
    linkAccount.mockResolvedValue({ success: true, role: 'admin' })

    render(<AdminAccount onBackToDemo={vi.fn()} />)

    // Wait for verified session
    expect(await screen.findByText(/System Admin Workspace/i)).toBeInTheDocument()

    // Navigate to Users tab
    fireEvent.click(await screen.findByRole('button', { name: /Accounts & Roles/i }))
    expect(await screen.findByText('Account Lifecycle & Role Governance')).toBeInTheDocument()

    // Trigger sensitive action: change role of Amina Njeri to Extension Officer
    const roleSelect = screen.getByLabelText('Role for amina.njeri@example.com')
    fireEvent.change(roleSelect, { target: { value: 'extension_officer' } })

    // Security Verification Modal should appear
    expect(await screen.findByTestId('reauth-modal')).toBeInTheDocument()
    expect(screen.getByText(/Security Verification Required/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Change role of amina\.njeri@example\.com to extension_officer/i),
    ).toBeInTheDocument()

    // Fill password and confirm
    fireEvent.change(screen.getByLabelText(/Administrator Password \*/i), {
      target: { value: 'AdminPassword@2026!' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Proceed/i }))

    // Verify re-auth password was submitted to Supabase auth
    await waitFor(() => {
      expect(signInWithPasswordMock).toHaveBeenCalledWith({
        email: 'superadmin@soilsync.ke',
        password: 'AdminPassword@2026!',
      })
    })

    // Modal should close after successful verification
    await waitFor(() => {
      expect(screen.queryByTestId('reauth-modal')).not.toBeInTheDocument()
    })
  })
})
