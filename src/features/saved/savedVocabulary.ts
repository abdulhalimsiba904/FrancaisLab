export type SavedResultAction = 'translate' | 'explain' | 'grammar' | 'example'

export interface SavedVocabularyItem {
  id: string
  text: string
  results: Partial<Record<SavedResultAction, string>>
  sourceName: string
  sourceDocumentId?: string
  sourcePosition?: { label: 'Page' | 'Slide'; number: number }
  savedAt: string
}

export interface NewSavedVocabularyItem {
  text: string
  results: Partial<Record<SavedResultAction, string>>
  sourceName: string
  sourceDocumentId?: string
  sourcePosition?: { label: 'Page' | 'Slide'; number: number }
}

export type SavedItemsResult = { ok: true; items: SavedVocabularyItem[] } | { ok: false; items: SavedVocabularyItem[]; error: string }

const STORAGE_KEY = 'francaislab.saved.v1'
const CHANGE_EVENT = 'francaislab:saved-items-changed'
const ACTIONS: SavedResultAction[] = ['translate', 'explain', 'grammar', 'example']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isSavedItem(value: unknown): value is SavedVocabularyItem {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.text !== 'string'
    || typeof value.sourceName !== 'string' || typeof value.savedAt !== 'string' || !isRecord(value.results)) return false
  if (value.sourceDocumentId !== undefined && typeof value.sourceDocumentId !== 'string') return false
  if (Object.entries(value.results).some(([action, result]) => !ACTIONS.includes(action as SavedResultAction) || typeof result !== 'string')) return false
  if (value.sourcePosition !== undefined) {
    const position = value.sourcePosition
    if (!isRecord(position) || (position.label !== 'Page' && position.label !== 'Slide')
      || typeof position.number !== 'number' || !Number.isInteger(position.number) || position.number < 1) return false
  }
  return Number.isFinite(Date.parse(value.savedAt))
}

function dispatchChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT))
}

function storageError(): string {
  return 'Browser storage is unavailable or full. Free up space or check your browser settings, then try again.'
}

export function readSavedVocabulary(): SavedItemsResult {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ok: true, items: [] }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { ok: false, items: [], error: 'Saved French could not be read. Your browser data may be damaged.' }
    const items = parsed.filter(isSavedItem).sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    if (items.length !== parsed.length) return { ok: false, items, error: 'Some saved items could not be read and were left out of the list.' }
    return { ok: true, items }
  } catch {
    return { ok: false, items: [], error: 'Saved French could not be read. Check that browser storage is available.' }
  }
}

export function saveVocabularyItem(input: NewSavedVocabularyItem): SavedItemsResult {
  const current = readSavedVocabulary()
  if (!current.ok) return current
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const item: SavedVocabularyItem = {
    ...input,
    id,
    results: { ...input.results },
    savedAt: new Date().toISOString(),
  }
  const items = [item, ...current.items]
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    dispatchChange()
    return { ok: true, items }
  } catch {
    return { ok: false, items: current.items, error: storageError() }
  }
}

export function deleteVocabularyItem(id: string): SavedItemsResult {
  const current = readSavedVocabulary()
  if (!current.ok) return current
  const items = current.items.filter((item) => item.id !== id)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    dispatchChange()
    return { ok: true, items }
  } catch {
    return { ok: false, items: current.items, error: storageError() }
  }
}

export function updateVocabularySourceId(id: string, sourceDocumentId: string): SavedItemsResult {
  const current = readSavedVocabulary()
  if (!current.ok) return current
  const items = current.items.map((item) => item.id === id ? { ...item, sourceDocumentId } : item)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    dispatchChange()
    return { ok: true, items }
  } catch {
    return { ok: false, items: current.items, error: storageError() }
  }
}

export function subscribeToSavedVocabulary(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}
