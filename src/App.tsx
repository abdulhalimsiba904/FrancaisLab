import { useRef, useState, type ChangeEvent } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import DocumentReader from './features/reader/DocumentReader'
import { getDocumentType } from './features/reader/documentTypes'
import { getSelectedDocument, getSelectedDocumentId, getSessionDocument, setSelectedDocument } from './features/reader/selectedDocument'
import SavedPage from './features/saved/SavedPage'

function AppLayout() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/" aria-label="FrançaisLab home">
            <span className="brand-mark" aria-hidden="true">fl</span>
            <span>Français<span className="brand-light">Lab</span></span>
          </NavLink>
          <nav className="primary-nav" aria-label="Main navigation">
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/reader">Reader</NavLink>
            <NavLink to="/saved">My Saved French</NavLink>
          </nav>
        </div>
      </header>
      <main id="main-content" className="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/reader" element={<ReaderPage />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </main>
      <footer className="site-footer"><span>Made for focused French study</span><span>FrançaisLab · V1</span></footer>
    </div>
  )
}

function HomePage() {
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [selectionError, setSelectionError] = useState('')

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!getDocumentType(file)) {
      setSelectionError('Choose a PDF or PowerPoint presentation (.pptx) to continue.')
      return
    }
    setSelectionError('')
    setSelectedDocument(file)
    navigate('/reader')
  }

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> YOUR FRENCH STUDY SPACE</p>
          <h1>Study French without leaving your <em>study material.</em></h1>
          <p className="hero-description">A focused place to work through the French course materials you already use at university.</p>
          <div className="hero-actions">
            <button className="button button-primary" type="button" onClick={() => fileInput.current?.click()}>Choose course material <span aria-hidden="true">↗</span></button>
            <input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={handleFileChange} aria-label="Choose a PDF or PowerPoint presentation" />
            <NavLink className="button button-secondary" to="/saved">View saved French</NavLink>
          </div>
          {selectionError && <p className="reader-message reader-message-error" role="alert">{selectionError}</p>}
          <p className="format-note"><span aria-hidden="true">▤</span> Built for course PDFs and PowerPoint slides</p>
        </div>
        <div className="study-card" aria-label="Example study material card">
          <div className="card-topline"><span>YOUR MATERIAL</span><span className="file-type">PDF</span></div>
          <div className="document-preview" aria-hidden="true">
            <div className="preview-label">CHAPITRE 03 <span>·</span> LES MÉDIAS</div>
            <div className="preview-title">La presse<br />française</div>
            <div className="preview-rule" />
            <div className="preview-line long" /><div className="preview-line medium" />
            <div className="preview-line long" /><div className="preview-line short" />
            <div className="highlighted-word">quotidien <span>·</span> daily</div>
          </div>
          <div className="card-caption"><span className="caption-icon">✳</span><span><strong>Your materials, your pace</strong><small>Stay with the course content</small></span><span className="caption-arrow">↗</span></div>
        </div>
      </section>
      <section className="welcome-row" aria-label="Getting started">
        <div><span className="step-number">01</span><span><strong>Bring your course material</strong><small>Start with a French PDF or slide deck.</small></span></div>
        <div><span className="step-number">02</span><span><strong>Study with more focus</strong><small>A calm workspace for your coursework.</small></span></div>
        <div><span className="step-number">03</span><span><strong>Keep words close</strong><small>Your saved vocabulary has its own space.</small></span></div>
      </section>
    </>
  )
}

function ReaderPage() {
  const location = useLocation()
  const routeState = location.state as {
    sourceReturn?: unknown
    sourceDocumentId?: unknown
    sourceName?: unknown
    sourceItemId?: unknown
    sourceLinkWarning?: unknown
    sourcePosition?: unknown
  } | null
  const sourceReturn = routeState?.sourceReturn === true
  const requestedId = typeof routeState?.sourceDocumentId === 'string' ? routeState.sourceDocumentId : undefined
  const file = requestedId ? getSessionDocument(requestedId) : getSelectedDocument()
  const documentId = requestedId ?? getSelectedDocumentId()
  const type = file ? getDocumentType(file) : undefined
  const value = routeState?.sourcePosition
  const savedPosition = isSavedPosition(value) ? value : undefined
  const positionMatchesDocument = Boolean(savedPosition
    && ((type === 'pdf' && savedPosition.label === 'Page') || (type === 'pptx' && savedPosition.label === 'Slide')))

  return <DocumentReader
    file={file}
    documentId={documentId}
    missingSourceName={sourceReturn && typeof routeState?.sourceName === 'string' ? routeState.sourceName : undefined}
    missingSourceItemId={sourceReturn && typeof routeState?.sourceItemId === 'string' ? routeState.sourceItemId : undefined}
    missingSourcePosition={savedPosition}
    initialPosition={positionMatchesDocument ? savedPosition : undefined}
    sourceLocationMissing={sourceReturn && !positionMatchesDocument}
    sourceLinkWarning={sourceReturn && routeState?.sourceLinkWarning === true}
  />
}

function isSavedPosition(value: unknown): value is { label: 'Page' | 'Slide'; number: number } {
  if (!value || typeof value !== 'object') return false
  const position = value as { label?: unknown; number?: unknown }
  return (position.label === 'Page' || position.label === 'Slide')
    && typeof position.number === 'number'
    && Number.isInteger(position.number)
    && position.number >= 1
}

export default function App() {
  return <AppLayout />
}
