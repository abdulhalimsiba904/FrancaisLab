export function parseAllowedOrigins(value = '') {
  if (!value.trim()) return []
  return value.split(',').map((item) => {
    const origin = item.trim()
    let parsed
    try {
      parsed = new URL(origin)
    } catch {
      throw new Error('Invalid server configuration for ALLOWED_ORIGINS.')
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('Invalid server configuration for ALLOWED_ORIGINS.')
    }
    return parsed.origin
  })
}
