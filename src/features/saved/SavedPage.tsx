import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { activateSessionDocument, getSessionDocument, setSelectedDocument } from '../reader/selectedDocument'
import { getDocumentType } from '../reader/documentTypes'
import {
  deleteVocabularyItem,
  readSavedVocabulary,
  subscribeToSavedVocabulary,
  updateVocabularySourceId,
  type SavedItemsResult,
  type SavedResultAction,
  type SavedVocabularyItem,
} from './savedVocabulary'

const RESULT_LABELS: Record<SavedResultAction, string> = {
  translate: 'Translation',
  explain: 'Explanation',
  grammar: 'Grammar',
  example: 'Example',
}

function SavedItem({ item, onDelete }: { item: SavedVocabularyItem; onDelete: (id: string) => void }) {
  const navigate = useNavigate()
  const sourceInput = useRef<HTMLInputElement>(null)
  const [sourceError, setSourceError] = useState('')
  const sessionSource = item.sourceDocumentId ? getSessionDocument(item.sourceDocumentId) : undefined
  const currentSource = sessionSource?.name === item.sourceName ? sessionSource : undefined

  function openAvailableSource(documentId: string, sourceLinkWarning = false) {
    activateSessionDocument(documentId)
    navigate('/reader', {
      state: {
        sourceReturn: true,
        sourceDocumentId: documentId,
        sourceName: item.sourceName,
        sourceItemId: item.id,
        ...(sourceLinkWarning ? { sourceLinkWarning: true } : {}),
        ...(item.sourcePosition ? { sourcePosition: item.sourcePosition } : {}),
      },
    })
  }

  function handleOpenSource() {
    setSourceError('')
    if (currentSource && item.sourceDocumentId) {
      openAvailableSource(item.sourceDocumentId)
      return
    }
    sourceInput.current?.click()
  }

  function handleSourceFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!item.sourceName || file.name !== item.sourceName) {
      setSourceError(`This file is named “${file.name}”. Choose the original file named “${item.sourceName}”.`)
      return
    }
    if (!getDocumentType(file)) {
      setSourceError('The selected source must be a PDF or PowerPoint file (.pptx).')
      return
    }
    const documentId = setSelectedDocument(file)
    const linkResult = updateVocabularySourceId(item.id, documentId)
    openAvailableSource(documentId, !linkResult.ok)
  }

  return (
    <li className="saved-card">
      <div className="saved-card-heading">
        <h2 lang="fr">{item.text}</h2>
        <button className="saved-delete" type="button" onClick={() => onDelete(item.id)} aria-label={`Delete saved French item: ${item.text.slice(0, 70)}`}>
          Delete
        </button>
      </div>
      {Object.entries(item.results).map(([action, result]) => result && (
        <section className="saved-result" key={action}>
          <h3>{RESULT_LABELS[action as SavedResultAction]}</h3>
          <p>{result}</p>
        </section>
      ))}
      <div className="saved-card-meta">
        <span>{item.sourceName}{item.sourcePosition ? ` · ${item.sourcePosition.label} ${item.sourcePosition.number}` : ''}</span>
        <time dateTime={item.savedAt}>{new Date(item.savedAt).toLocaleString()}</time>
      </div>
      {item.sourceName ? (
        <div className="saved-source">
          {!currentSource && <p className="saved-source-help">Source files stay in memory for this app session. Choose the original local file to return to it; the filename must match.</p>}
          {!item.sourcePosition && <p className="saved-source-help">No page or slide was saved; the document will open at its beginning.</p>}
          <button className="saved-open-source" type="button" onClick={handleOpenSource}>
            {currentSource ? `Open source${item.sourcePosition ? ` · ${item.sourcePosition.label} ${item.sourcePosition.number}` : ''}` : 'Open source · choose file'}
          </button>
          <input
            ref={sourceInput}
            className="visually-hidden"
            type="file"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            aria-label={`Choose the original source file named ${item.sourceName}`}
            onChange={handleSourceFile}
          />
          {sourceError && <p className="reader-message reader-message-error saved-source-error" role="alert">{sourceError}</p>}
        </div>
      ) : <p className="saved-source-help" role="status">Source document details are unavailable for this saved item.</p>}
    </li>
  )
}

export default function SavedPage() {
  const [items, setItems] = useState<SavedVocabularyItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const refresh = () => {
      const result = readSavedVocabulary()
      setItems(result.items)
      setError(result.ok ? '' : result.error)
    }
    refresh()
    return subscribeToSavedVocabulary(refresh)
  }, [])

  function handleDelete(id: string) {
    const result: SavedItemsResult = deleteVocabularyItem(id)
    setItems(result.items)
    setError(result.ok ? '' : result.error)
  }

  return (
    <section className="placeholder-page saved-page" aria-labelledby="saved-title">
      <p className="eyebrow"><span className="eyebrow-dot" /> YOUR PERSONAL COLLECTION</p>
      <h1 id="saved-title">My Saved French</h1>
      <p className="page-intro">French text and study notes saved on this device. Your documents are never stored here.</p>
      {error && <p className="reader-message reader-message-error" role="alert">{error}</p>}
      {items.length === 0 ? (
        <div className="placeholder-panel saved-empty" role="status">
          <span className="panel-icon" aria-hidden="true">✳</span>
          <div><h2>No saved French yet</h2><p>Select a word or phrase in a course PDF or slide deck, then choose Save to keep it here.</p></div>
        </div>
      ) : (
        <ul className="saved-list" aria-label="Saved French vocabulary">
          {items.map((item) => <SavedItem key={item.id} item={item} onDelete={handleDelete} />)}
        </ul>
      )}
    </section>
  )
}
