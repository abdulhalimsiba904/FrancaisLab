import { lazy, Suspense, useRef, useState, type ChangeEvent } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { formatFileSize, getDocumentType } from './documentTypes'
import { setSelectedDocument } from './selectedDocument'
import { updateVocabularySourceId } from '../saved/savedVocabulary'

const PdfReader = lazy(() => import('./components/PdfReader'))
const PptxReader = lazy(() => import('./components/PptxReader'))

interface DocumentReaderProps {
  file?: File
  documentId?: string
  initialPosition?: { label: 'Page' | 'Slide'; number: number }
  sourceLocationMissing?: boolean
  missingSourceName?: string
  missingSourceItemId?: string
  missingSourcePosition?: { label: 'Page' | 'Slide'; number: number }
  sourceLinkWarning?: boolean
}

export default function DocumentReader({ file, documentId, initialPosition, sourceLocationMissing = false, missingSourceName, missingSourceItemId, missingSourcePosition, sourceLinkWarning = false }: DocumentReaderProps) {
  const navigate = useNavigate()
  const missingSourceInput = useRef<HTMLInputElement>(null)
  const readerFileInput = useRef<HTMLInputElement>(null)
  const [sourceError, setSourceError] = useState('')

  function handleMissingSourceFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) {
      input.value = ''
      return
    }
    if (selectedFile.name !== missingSourceName) {
      setSourceError(`Choose the original local file named “${missingSourceName}”.`)
      input.value = ''
      return
    }
    if (!getDocumentType(selectedFile)) {
      setSourceError('Choose the original PDF or PowerPoint file (.pptx).')
      input.value = ''
      return
    }
    const newDocumentId = setSelectedDocument(selectedFile)
    const linkResult = missingSourceItemId ? updateVocabularySourceId(missingSourceItemId, newDocumentId) : undefined
    navigate('/reader', {
      replace: true,
      state: {
        sourceReturn: true,
        sourceDocumentId: newDocumentId,
        sourceName: selectedFile.name,
        sourceItemId: missingSourceItemId,
        ...(linkResult && !linkResult.ok ? { sourceLinkWarning: true } : {}),
        ...(missingSourcePosition ? { sourcePosition: missingSourcePosition } : {}),
      },
    })
    input.value = ''
  }

  function handleReaderFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) {
      input.value = ''
      return
    }
    if (!getDocumentType(selectedFile)) {
      setSourceError('Choose a PDF or PowerPoint presentation (.pptx) to continue.')
      input.value = ''
      return
    }
    setSourceError('')
    const readerDocumentId = setSelectedDocument(selectedFile)
    navigate('/reader', { replace: true, state: { readerDocumentId } })
    input.value = ''
  }

  if (!file) {
    return (
      <section className="reader-page">
        <p className="eyebrow"><span className="eyebrow-dot" /> YOUR STUDY SPACE</p>
        <h1>Reader</h1>
        <div className="reader-empty reader-message" role="status">
          <span className="panel-icon" aria-hidden="true">▤</span>
          <div>
            <h2>{missingSourceName ? 'Select the original source file again' : 'Choose a document to begin'}</h2>
            <p>{missingSourceName ? `“${missingSourceName}” is no longer available in this app session. Choose that local file again to return to its saved location.` : 'Choose a local PDF or PowerPoint to begin. If the browser refreshed while opening a document, select it again here. Files stay in memory; document contents are never saved.'}</p>
            {missingSourceName ? <>
              <button className="button button-primary" type="button" onClick={() => { setSourceError(''); missingSourceInput.current?.click() }}>Choose original file</button>
              <input ref={missingSourceInput} className="visually-hidden" type="file" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" aria-label={`Choose the original source file named ${missingSourceName}`} onChange={handleMissingSourceFile} />
              {sourceError && <p className="reader-message reader-message-error" role="alert">{sourceError}</p>}
            </> : <>
              <button className="button button-primary" type="button" onClick={() => { setSourceError(''); readerFileInput.current?.click() }}>Choose local PDF or PowerPoint</button>
              <input ref={readerFileInput} className="visually-hidden" type="file" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" aria-label="Choose a local PDF or PowerPoint presentation" onChange={handleReaderFile} />
              {sourceError && <p className="reader-message reader-message-error" role="alert">{sourceError}</p>}
            </>}
          </div>
        </div>
      </section>
    )
  }

  const type = getDocumentType(file)
  if (!type) {
    return <section className="reader-page"><h1>Unsupported file</h1><p className="reader-message reader-message-error" role="alert">Choose a PDF or PowerPoint presentation (.pptx).</p><NavLink className="button button-secondary" to="/">Back to materials</NavLink></section>
  }

  return (
    <section className="reader-page" aria-labelledby="reader-title">
      <div className="reader-heading">
        <div><p className="eyebrow"><span className="eyebrow-dot" /> READING LOCALLY</p><h1 id="reader-title">{file.name}</h1><p className="reader-file-meta">{type.toUpperCase()} <span aria-hidden="true">·</span> {formatFileSize(file.size)}</p></div>
        <NavLink className="button button-secondary reader-back" to="/">Choose another file</NavLink>
      </div>
      <p className="reader-ai-notice"><strong>Privacy notice:</strong> Translate, Explain, Grammar, and Example send selected text to Groq when configured and may also send it to Gemini if Groq is temporarily unavailable. Explain and Grammar may include short nearby context. Your document is not sent.</p>
      {sourceLocationMissing && <p className="reader-message reader-message-notice" role="status">The source document is available, but this saved item has no usable page or slide location. The document is open at its beginning.</p>}
      {sourceLinkWarning && <p className="reader-message reader-message-error" role="alert">The document is open, but its session link could not be updated in browser storage. You may need to choose the source file again after leaving this session.</p>}
      <Suspense fallback={<div className="reader-viewer"><p className="reader-message" role="status">Preparing document reader…</p></div>}>
        {type === 'pdf'
          ? <PdfReader key={documentId ?? file.name + file.lastModified} file={file} documentId={documentId} initialPosition={initialPosition} />
          : <PptxReader key={documentId ?? file.name + file.lastModified} file={file} documentId={documentId} initialPosition={initialPosition} />}
      </Suspense>
    </section>
  )
}
