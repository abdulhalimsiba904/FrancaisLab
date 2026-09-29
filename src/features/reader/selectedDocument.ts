const sessionDocuments = new Map<string, File>()
let selectedDocumentId: string | undefined

function createSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // A random fallback keeps local session references usable in older browsers.
  }
  return `document-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function setSelectedDocument(file: File): string {
  const id = createSessionId()
  sessionDocuments.set(id, file)
  selectedDocumentId = id
  return id
}

export function getSelectedDocument(): File | undefined {
  return selectedDocumentId ? sessionDocuments.get(selectedDocumentId) : undefined
}

export function getSelectedDocumentId(): string | undefined {
  return selectedDocumentId
}

export function getSessionDocument(id: string): File | undefined {
  return sessionDocuments.get(id)
}

export function activateSessionDocument(id: string): boolean {
  if (!sessionDocuments.has(id)) return false
  selectedDocumentId = id
  return true
}
