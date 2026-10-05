import { describe, expect, it } from 'vitest'
import { validatePasswordPolicy } from './passwordPolicy'

describe('validatePasswordPolicy', () => {
  it('validates standard user passwords correctly', () => {
    // Standard user needs at least 8 chars
    expect(validatePasswordPolicy('short').isValid).toBe(false)
    expect(validatePasswordPolicy('short').errors).toContain(
      'Password must be at least 8 characters long.',
    )

    expect(validatePasswordPolicy('12345678').isValid).toBe(true)
    expect(validatePasswordPolicy('anyStrongPassword!2026').isValid).toBe(true)
  })

  it('enforces hardened admin password policy', () => {
    // Admin password needs min 12 chars, upper, lower, number, special char
    const tooShort = validatePasswordPolicy('Admin!1', 'admin')
    expect(tooShort.isValid).toBe(false)
    expect(tooShort.errors).toContain('Admin password must be at least 12 characters long.')

    const missingUpper = validatePasswordPolicy('adminpassword!123', 'admin')
    expect(missingUpper.isValid).toBe(false)
    expect(missingUpper.errors).toContain('Must contain at least one uppercase letter (A-Z).')

    const missingLower = validatePasswordPolicy('ADMINPASSWORD!123', 'admin')
    expect(missingLower.isValid).toBe(false)
    expect(missingLower.errors).toContain('Must contain at least one lowercase letter (a-z).')

    const missingNumber = validatePasswordPolicy('AdminPassword!Special', 'admin')
    expect(missingNumber.isValid).toBe(false)
    expect(missingNumber.errors).toContain('Must contain at least one number (0-9).')

    const missingSpecial = validatePasswordPolicy('AdminPassword1234', 'admin')
    expect(missingSpecial.isValid).toBe(false)
    expect(missingSpecial.errors).toContain(
      'Must contain at least one symbol or special character (!@#$%^&* etc.).',
    )

    const validAdmin = validatePasswordPolicy('Admin@Secured2026!', 'admin')
    expect(validAdmin.isValid).toBe(true)
    expect(validAdmin.errors).toHaveLength(0)
  })
})
