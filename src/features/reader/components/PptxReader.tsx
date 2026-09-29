import { useEffect, useState } from 'react'
import JSZip from 'jszip'
import SelectionScope from '../selection/SelectionScope'

interface Slide {
  paragraphs: string[]
}

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

async function readPresentation(file: File): Promise<Slide[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('This PowerPoint file could not be opened. It may be damaged or not a .pptx file.')
  }
  const presentation = zip.file('ppt/presentation.xml')
  if (!presentation) throw new Error('This file is not a readable PowerPoint presentation. Choose a .pptx file.')

  const parser = new DOMParser()
  const presentationXml = parser.parseFromString(await presentation.async('text'), 'application/xml')
  if (presentationXml.querySelector('parsererror')) throw new Error('The PowerPoint presentation file could not be read.')
  const relationshipXml = zip.file('ppt/_rels/presentation.xml.rels')
  if (!relationshipXml) throw new Error('The PowerPoint presentation has no readable slide list.')
  const relationships = parser.parseFromString(await relationshipXml.async('text'), 'application/xml')
  const targets = new Map<string, string>()
  for (const relationship of Array.from(relationships.getElementsByTagNameNS('*', 'Relationship'))) {
    const id = relationship.getAttribute('Id')
    const target = relationship.getAttribute('Target')
    if (id && target && relationship.getAttribute('Type')?.endsWith('/slide')) {
      targets.set(id, normalizePath(target.startsWith('/') ? target.slice(1) : `ppt/${target}`))
    }
  }

  const slideIds = Array.from(presentationXml.getElementsByTagNameNS('*', 'sldId'))
  const slidePaths = slideIds.map((slideId) => {
    const relationshipId = slideId.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      ?? Array.from(slideId.attributes).find((attribute) => attribute.localName === 'id')?.value
    return relationshipId ? targets.get(relationshipId) : undefined
  }).filter((path): path is string => Boolean(path))

  const slides: Slide[] = []
  for (const path of slidePaths) {
    const slideFile = zip.file(path)
    if (!slideFile) throw new Error('A slide in this PowerPoint presentation could not be loaded.')
    const xml = parser.parseFromString(await slideFile.async('text'), 'application/xml')
    if (xml.querySelector('parsererror')) throw new Error('A slide in this PowerPoint presentation could not be read.')
    const paragraphs = Array.from(xml.getElementsByTagNameNS('*', 'p')).map((paragraph) =>
      Array.from(paragraph.getElementsByTagNameNS('*', 't')).map((text) => text.textContent ?? '').join(''),
    ).filter((text) => text.trim().length > 0)
    slides.push({ paragraphs })
  }

  if (!slides.length) throw new Error('No readable slides were found in this PowerPoint presentation.')
  return slides
}

interface PptxReaderProps {
  file: File
  documentId?: string
  initialPosition?: { label: 'Page' | 'Slide'; number: number }
}

export default function PptxReader({ file, documentId, initialPosition }: PptxReaderProps) {
  const [slides, setSlides] = useState<Slide[]>([])
  const [slideNumber, setSlideNumber] = useState(1)
  const [error, setError] = useState('')
  const [positionNotice, setPositionNotice] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    readPresentation(file).then((result) => {
      if (!active) return
      setSlides(result)
      if (initialPosition?.label === 'Slide' && initialPosition.number > result.length) {
        setSlideNumber(result.length)
        setPositionNotice(`Saved slide ${initialPosition.number} is not in this deck. Showing its last slide, ${result.length}.`)
      } else {
        setSlideNumber(initialPosition?.label === 'Slide' ? initialPosition.number : 1)
        setPositionNotice('')
      }
      setError('')
    }).catch((cause: unknown) => {
      if (!active) return
      setError(cause instanceof Error ? cause.message : 'This PowerPoint presentation could not be opened.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [file])

  if (loading) return <div className="reader-viewer"><p className="reader-message" role="status">Opening PowerPoint slides…</p></div>
  if (error) return <div className="reader-viewer"><p className="reader-message reader-message-error" role="alert">{error}</p></div>

  const slide = slides[slideNumber - 1]
  return (
    <div className="reader-viewer">
      {positionNotice && <p className="reader-message reader-message-notice" role="status">{positionNotice}</p>}
      <div className="reader-toolbar" role="group" aria-label="PowerPoint slide controls">
        <div className="page-controls" role="group" aria-label="Slide navigation">
          <button className="control-button" type="button" onClick={() => setSlideNumber((current) => Math.max(1, current - 1))} disabled={slideNumber <= 1} aria-label="Previous slide">← <span>Previous</span></button>
          <span className="page-count" aria-live="polite">Slide <strong>{slideNumber}</strong> of <strong>{slides.length}</strong></span>
          <button className="control-button" type="button" onClick={() => setSlideNumber((current) => Math.min(slides.length, current + 1))} disabled={slideNumber >= slides.length} aria-label="Next slide"><span>Next</span> →</button>
        </div>
      </div>
      <SelectionScope key={`${file.name}-${file.size}-${file.lastModified}-${slideNumber}`} sourceName={file.name} sourceDocumentId={documentId} sourcePosition={{ label: 'Slide', number: slideNumber }}>
        <article className="pptx-slide" aria-label={`Slide ${slideNumber}`}>
          {slide.paragraphs.length ? slide.paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>) : <p className="slide-empty">No readable text was found on this slide. It may contain only images or unsupported objects; OCR is not available.</p>}
        </article>
      </SelectionScope>
      {slide.paragraphs.length > 0 && <p className="slide-selection-note">Slide text is selectable. Images and complex PowerPoint styling are not reproduced in this text view.</p>}
    </div>
  )
}
