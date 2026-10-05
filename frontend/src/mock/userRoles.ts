export type UserRole = 'farmer' | 'extension-officer' | 'agrodealer' | 'admin'

export type RoleNavigationItem = {
  label: string
  anchor: string
}

export type RoleWorkflow = {
  key: UserRole
  label: string
  caption: string
  initials: string
  description: string
  navigation: RoleNavigationItem[]
}

export const roleOptions: Array<{
  key: UserRole
  label: string
  caption: string
  initials: string
}> = [
  { key: 'farmer', label: 'Farmer', caption: 'FARMER WORKSPACE', initials: 'F' },
  { key: 'extension-officer', label: 'Extension officer', caption: 'FIELD TEAM', initials: 'EO' },
  { key: 'agrodealer', label: 'Agrodealer', caption: 'INPUT NETWORK', initials: 'AD' },
  { key: 'admin', label: 'Admin', caption: 'SYSTEM ADMIN', initials: 'SA' },
]

export const workflowByRole: Record<UserRole, RoleWorkflow> = {
  farmer: {
    key: 'farmer',
    label: 'Farmer',
    caption: 'FARMER WORKSPACE',
    initials: 'F',
    description:
      'Track field readings, review local preview data, and monitor the next sync cycle.',
    navigation: [
      { label: 'Overview', anchor: '#overview' },
      { label: 'My farm', anchor: '#farm' },
      { label: 'Soil readings', anchor: '#measurements' },
      { label: 'Guidance', anchor: '#guidance' },
    ],
  },
  'extension-officer': {
    key: 'extension-officer',
    label: 'Extension officer',
    caption: 'FIELD TEAM',
    initials: 'EO',
    description: 'Review farmer plans, diagnose field risks, and prioritise support in each ward.',
    navigation: [
      { label: 'Dashboard', anchor: '#overview' },
      { label: 'Farmers', anchor: '#farmers' },
      { label: 'Visits', anchor: '#visits' },
      { label: 'Alerts', anchor: '#alerts' },
    ],
  },
  agrodealer: {
    key: 'agrodealer',
    label: 'Agrodealer',
    caption: 'INPUT NETWORK',
    initials: 'AD',
    description:
      'Coordinate input availability, product matching, and close-to-farm recommendations.',
    navigation: [
      { label: 'Dashboard', anchor: '#overview' },
      { label: 'Inventory', anchor: '#inventory' },
      { label: 'Orders', anchor: '#orders' },
      { label: 'Coverage', anchor: '#coverage' },
    ],
  },
  admin: {
    key: 'admin',
    label: 'Admin',
    caption: 'SYSTEM ADMIN',
    initials: 'SA',
    description:
      'Monitor release quality, seed data, role access, and operational health across the app.',
    navigation: [
      { label: 'Overview', anchor: '#overview' },
      { label: 'Users', anchor: '#users' },
      { label: 'Monitoring', anchor: '#monitoring' },
      { label: 'Settings', anchor: '#settings' },
    ],
  },
}
