export class ProviderFailure extends Error {
  constructor(kind, transient, details = {}) {
    super(kind)
    this.name = 'ProviderFailure'
    this.kind = kind
    this.transient = transient
    this.status = Number.isInteger(details.status) ? details.status : undefined
    this.retryAfterSeconds = Number.isInteger(details.retryAfterSeconds) && details.retryAfterSeconds > 0
      ? Math.min(details.retryAfterSeconds, 300)
      : undefined
  }
}

export function isConfiguredProvider(provider) {
  return Boolean(provider && provider.apiKey)
}
