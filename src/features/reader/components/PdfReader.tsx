import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import SelectionScope from '../selection/SelectionScope'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

interface PdfReaderProps {
  file: File
  documentId?: string
  initialPosition?: { label: 'Page' | 'Slide'; number: number }
}

export default function PdfReader({ file, documentId, initialPosition }: PdfReaderProps) {
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(initialPosition?.label === 'Page' ? initialPosition.number : 1)
  const [scale, setScale] = useState(1)
  const [hasSelectableText, setHasSelectableText] = useState<boolean | undefined>()
  const [error, setError] = useState('')
  const [positionNotice, setPositionNotice] = useState('')
  const pageWrap = useRef<HTMLDivElement>(null)
  const [pageWidth, setPageWidth] = useState(720)

  useEffect(() => {
    const element = pageWrap.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setPageWidth(Math.max(280, Math.min(900, entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function onDocumentLoadSuccess(pdf: PDFDocumentProxy) {
    setNumPages(pdf.numPages)
    if (initialPosition?.label === 'Page' && initialPosition.number > pdf.numPages) {
      setPageNumber(pdf.numPages)
      setPositionNotice(`Saved page ${initialPosition.number} is not in this PDF. Showing its last page, ${pdf.numPages}.`)
    } else {
      setPageNumber(initialPosition?.label === 'Page' ? initialPosition.number : 1)
      setPositionNotice('')
    }
    setError('')
  }

  return (
    <div className="reader-viewer">
      <div className="reader-toolbar" role="group" aria-label="PDF reader controls">
        <div className="page-controls" role="group" aria-label="Page navigation">
          <button className="control-button" type="button" onClick={() => { setPageNumber((page) => Math.max(1, page - 1)); setHasSelectableText(undefined) }} disabled={pageNumber <= 1} aria-label="Previous page">← <span>Previous</span></button>
          <span className="page-count" aria-live="polite">Page <strong>{numPages ? pageNumber : '—'}</strong> of <strong>{numPages || '—'}</strong></span>
          <button className="control-button" type="button" onClick={() => { setPageNumber((page) => Math.min(numPages, page + 1)); setHasSelectableText(undefined) }} disabled={!numPages || pageNumber >= numPages} aria-label="Next page"><span>Next</span> →</button>
        </div>
        <div className="zoom-controls" role="group" aria-label="PDF zoom controls">
          <button className="control-button zoom-button" type="button" onClick={() => setScale((value) => Math.max(.6, Number((value - .1).toFixed(1))))} disabled={scale <= .6} aria-label="Zoom out">−</button>
          <span className="zoom-label" aria-live="polite">{Math.round(scale * 100)}%</span>
          <button className="control-button zoom-button" type="button" onClick={() => setScale((value) => Math.min(1.8, Number((value + .1).toFixed(1))))} disabled={scale >= 1.8} aria-label="Zoom in">+</button>
        </div>
      </div>
      {error && <p className="reader-message reader-message-error" role="alert">{error}</p>}
      {positionNotice && <p className="reader-message reader-message-notice" role="status">{positionNotice}</p>}
      <Document file={file} onLoadSuccess={onDocumentLoadSuccess} onLoadError={() => setError('This PDF could not be opened. It may be damaged, password-protected, or use an unsupported format.')} loading={<p className="reader-message" role="status">Loading PDF…</p>} error={<p className="reader-message reader-message-error" role="alert">This PDF could not be rendered. Try another text-based PDF.</p>}>
        <div className="pdf-page-wrap" ref={pageWrap}>
          <SelectionScope key={`${file.name}-${file.size}-${file.lastModified}-${pageNumber}`} className="pdf-selection-scope" sourceName={file.name} sourceDocumentId={documentId} sourcePosition={{ label: 'Page', number: pageNumber }}>
            <Page pageNumber={pageNumber} width={pageWidth * scale} renderTextLayer renderAnnotationLayer onGetTextSuccess={(content) => setHasSelectableText(content.items.some((item) => 'str' in item && item.str.trim().length > 0))} onRenderError={() => setError('This PDF page could not be rendered. Try another page or document.')} loading={<p className="reader-message" role="status">Rendering page…</p>} />
          </SelectionScope>
        </div>
      </Document>
      {hasSelectableText === false && <p className="reader-message reader-message-notice" role="status">No selectable text was found on this page. It may be an image-only scan; FrançaisLab V1 does not include OCR.</p>}
    </div>
  )
}
