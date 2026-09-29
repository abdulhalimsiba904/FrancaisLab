export class ProviderFailure extends Error {
  constructor(kind, transient) {
    super(kind)
    this.name = 'ProviderFailure'
    this.kind = kind
    this.transient = transient
  }
}

export function isConfiguredProvider(provider) {
  return Boolean(provider && provider.apiKey)
}
