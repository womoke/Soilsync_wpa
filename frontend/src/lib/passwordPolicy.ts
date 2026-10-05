export interface PasswordValidationResult {
  isValid: boolean
  errors: string[]
}

/**
 * Validates password rules according to user role:
 * - Admin: min 12 characters, uppercase, lowercase, digit, special character.
 * - Standard users: min 8 characters.
 */
export function validatePasswordPolicy(password: string, role?: string): PasswordValidationResult {
  const errors: string[] = []

  if (role === 'admin') {
    if (password.length < 12) {
      errors.push('Admin password must be at least 12 characters long.')
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Must contain at least one uppercase letter (A-Z).')
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Must contain at least one lowercase letter (a-z).')
    }
    if (!/[0-9]/.test(password)) {
      errors.push('Must contain at least one number (0-9).')
    }
    if (!/[!@#$%^&*(),.?":{}|<>_\-=+~`]/.test(password)) {
      errors.push('Must contain at least one symbol or special character (!@#$%^&* etc.).')
    }
  } else {
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long.')
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
