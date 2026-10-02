import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { saveVocabularyItem, type SavedResultAction } from '../../saved/savedVocabulary'

interface SelectionScopeProps {
  children: ReactNode
  className?: string
  sourceName: string
  sourceDocumentId?: string
  sourcePosition?: { label: 'Page' | 'Slide'; number: number }
}

interface ToolbarState {
  text: string
}

interface ToolbarPosition {
  top: number
  left: number
}

type AIAction = SavedResultAction
type AIResults = Partial<Record<AIAction, string>>

type AIState =
  | { status: 'idle' }
  | { status: 'loading'; action: AIAction }
  | { status: 'success'; action: AIAction; result: string; usedBackup: boolean }
  | { status: 'error'; action: AIAction; message: string; retryable: boolean }

const AI_ACTIONS: { action: AIAction; label: string }[] = [
  { action: 'translate', label: 'Translate' },
  { action: 'explain', label: 'Explain' },
  { action: 'grammar', label: 'Grammar' },
  { action: 'example', label: 'Example' },
]

const ACTION_LABELS: Record<AIAction, string> = {
  translate: 'Translation',
  explain: 'Explanation',
  grammar: 'Grammar note',
  example: 'Example',
}

function nearbyContext(scope: HTMLElement, range: Range): string | undefined {
  const boundary = scope.querySelector('.pptx-slide, .react-pdf__Page__textContent') ?? scope
  if (!boundary.contains(range.startContainer) || !boundary.contains(range.endContainer)) return undefined

  try {
    const beforeRange = range.cloneRange()
    beforeRange.selectNodeContents(boundary)
    beforeRange.setEnd(range.startContainer, range.startOffset)
    const afterRange = range.cloneRange()
    afterRange.selectNodeContents(boundary)
    afterRange.setStart(range.endContainer, range.endOffset)
    const before = beforeRange.toString().slice(-120)
    const after = afterRange.toString().slice(0, 120)
    const context = `${before} ${after}`.trim().replace(/\s+/gu, ' ')
    return context ? context.slice(0, 320) : undefined
  } catch {
    return undefined
  }
}

export default function SelectionScope({ children, className = '', sourceName, sourceDocumentId, sourcePosition }: SelectionScopeProps) {
  const scopeRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const aiActionButtonsRef = useRef<Partial<Record<AIAction, HTMLButtonElement | null>>>({})
  const sheetBackdropRef = useRef<HTMLDivElement>(null)
  const mobileDialogRef = useRef<HTMLElement>(null)
  const mobileCloseRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const lastActionTriggerRef = useRef<HTMLElement | null>(null)
  const dialogWasOpenRef = useRef(false)
  const rangeRef = useRef<Range | null>(null)
  const preserveSelectionRef = useRef(false)
  const selectedTextRef = useRef('')
  const resultsRef = useRef<AIResults>({})
  const requestRef = useRef<AbortController | null>(null)
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null)
  const [position, setPosition] = useState<ToolbarPosition | null>(null)
  const [aiState, setAiState] = useState<AIState>({ status: 'idle' })
  const [results, setResults] = useState<AIResults>({})
  const [saveMessage, setSaveMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [mobileViewport, setMobileViewport] = useState(false)
  const [mobileSheetDismissed, setMobileSheetDismissed] = useState(false)
  const [selectionAnnouncement, setSelectionAnnouncement] = useState('')
  const mobileDialogOpen = mobileViewport && aiState.status !== 'idle' && !mobileSheetDismissed

  const clearSelection = useCallback(() => {
    if (selectedTextRef.current) setSelectionAnnouncement('Text selection cleared.')
    requestRef.current?.abort()
    requestRef.current = null
    rangeRef.current = null
    selectedTextRef.current = ''
    resultsRef.current = {}
    setResults({})
    setSaveMessage(null)
    setMobileSheetDismissed(false)
    setToolbar(null)
    setPosition(null)
    setAiState({ status: 'idle' })
  }, [])

  const updatePosition = useCallback(() => {
    const range = rangeRef.current
    const toolbarElement = toolbarRef.current
    if (!range || !toolbarElement) {
      setPosition(null)
      return
    }

    const viewport = window.visualViewport
    const viewportLeft = viewport?.offsetLeft ?? 0
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportWidth = viewport?.width ?? document.documentElement.clientWidth
    const viewportHeight = viewport?.height ?? window.innerHeight
    const rangeRects = Array.from(range.getClientRects())
    const visibleRect = rangeRects.find((rect) =>
      rect.bottom > viewportTop && rect.top < viewportTop + viewportHeight
      && rect.right > viewportLeft && rect.left < viewportLeft + viewportWidth,
    )
    if (!visibleRect) {
      setPosition(null)
      return
    }

    const toolbarRect = toolbarElement.getBoundingClientRect()
    const gap = 9
    const above = visibleRect.top - toolbarRect.height - gap
    const below = visibleRect.bottom + gap
    const top = above >= viewportTop + 8
      ? above
      : Math.min(below, viewportTop + viewportHeight - toolbarRect.height - 8)
    const desiredLeft = visibleRect.left + visibleRect.width / 2 - toolbarRect.width / 2
    const left = Math.max(viewportLeft + 8, Math.min(desiredLeft, viewportLeft + viewportWidth - toolbarRect.width - 8))
    setPosition({ top, left })
  }, [])

  useLayoutEffect(() => {
    if (toolbar) updatePosition()
  }, [toolbar, aiState, results, saveMessage, mobileViewport, mobileSheetDismissed, updatePosition])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setMobileViewport(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (mobileDialogOpen && !dialogWasOpenRef.current) {
      returnFocusRef.current = lastActionTriggerRef.current?.isConnected
        ? lastActionTriggerRef.current
        : document.activeElement instanceof HTMLElement ? document.activeElement : null
      mobileCloseRef.current?.focus()
    } else if (!mobileDialogOpen && dialogWasOpenRef.current) {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
      returnFocusRef.current = null
    }
    dialogWasOpenRef.current = mobileDialogOpen
  }, [mobileDialogOpen])

  useEffect(() => {
    if (!mobileDialogOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [mobileDialogOpen])

  const runAI = useCallback(async (action: AIAction) => {
    const text = selectedTextRef.current
    if (!text) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setMobileSheetDismissed(false)
    const nextResults = { ...resultsRef.current }
    delete nextResults[action]
    resultsRef.current = nextResults
    setResults(nextResults)
    setAiState({ status: 'loading', action })

    const payload: { action: AIAction; text: string; context?: string } = { action, text }
    const scope = scopeRef.current
    const range = rangeRef.current
    if ((action === 'explain' || action === 'grammar') && scope && range) {
      const context = nearbyContext(scope, range)
      if (context) payload.context = context
    }

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      let body: unknown
      try {
        body = await response.json()
      } catch {
        setAiState({
          status: 'error',
          action,
          message: 'The AI service returned an unreadable response. Please try again.',
          retryable: true,
        })
        return
      }

      if (!response.ok) {
        const error = (body as { error?: { message?: unknown; retryable?: unknown } })?.error
        setAiState({
          status: 'error',
          action,
          message: typeof error?.message === 'string' ? error.message : 'The request could not be completed. Please try again.',
          retryable: error?.retryable === true,
        })
        return
      }

      const result = body as { result?: unknown; usedBackup?: unknown }
      if (typeof result?.result !== 'string' || !result.result.trim()) {
        setAiState({
          status: 'error',
          action,
          message: 'The AI service returned an empty response. Please try again.',
          retryable: true,
        })
        return
      }
      const value = result.result.trim()
      resultsRef.current = { ...resultsRef.current, [action]: value }
      setResults(resultsRef.current)
      setAiState({ status: 'success', action, result: value, usedBackup: result.usedBackup === true })
    } catch {
      if (controller.signal.aborted) return
      setAiState({
        status: 'error',
        action,
        message: 'Could not reach the AI service. Check your connection and try again.',
        retryable: true,
      })
    } finally {
      if (requestRef.current === controller) requestRef.current = null
    }
  }, [])

  useEffect(() => {
    const scope = scopeRef.current
    if (!scope) return

    function isInsideScope(node: Node | null): boolean {
      if (!node || !scope) return false
      const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
      return Boolean(element && scope.contains(element))
    }

    function onSelectionChange() {
      const selection = document.getSelection()
      const text = selection?.toString() ?? ''
      if (!selection || !text.trim()) {
        const activeElement = document.activeElement
        if (preserveSelectionRef.current || (activeElement && toolbarRef.current?.contains(activeElement))) return
        clearSelection()
        return
      }

      if (!isInsideScope(selection.anchorNode) || !isInsideScope(selection.focusNode) || selection.rangeCount === 0) {
        clearSelection()
        return
      }

      const normalizedText = text.trim()
      if (selectedTextRef.current !== normalizedText) {
        requestRef.current?.abort()
        requestRef.current = null
        setAiState({ status: 'idle' })
        resultsRef.current = {}
        setResults({})
        setSaveMessage(null)
        setSelectionAnnouncement('Text selection changed. Study actions are available.')
      }
      selectedTextRef.current = normalizedText
      rangeRef.current = selection.getRangeAt(0).cloneRange()
      setToolbar({ text: normalizedText })
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && (toolbarRef.current?.contains(target) || sheetBackdropRef.current?.contains(target))) return
      preserveSelectionRef.current = false
      clearSelection()
    }

    const reposition = () => updatePosition()
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    window.visualViewport?.addEventListener('scroll', reposition)
    window.visualViewport?.addEventListener('resize', reposition)

    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      window.visualViewport?.removeEventListener('scroll', reposition)
      window.visualViewport?.removeEventListener('resize', reposition)
      requestRef.current?.abort()
      rangeRef.current = null
    }
  }, [clearSelection, updatePosition])

  const saveSelected = useCallback(() => {
    const text = selectedTextRef.current
    if (!text) return
    const saved = saveVocabularyItem({
      text,
      results: { ...resultsRef.current },
      sourceName,
      ...(sourceDocumentId ? { sourceDocumentId } : {}),
      ...(sourcePosition ? { sourcePosition } : {}),
    })
    setSaveMessage(saved.ok
      ? { kind: 'success', text: 'Saved on this device.' }
      : { kind: 'error', text: saved.error })
  }, [sourceDocumentId, sourceName, sourcePosition])

  function closeMobileDialog() {
    setMobileSheetDismissed(true)
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMobileDialog()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = mobileDialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')
    if (!focusable?.length) {
      event.preventDefault()
      mobileCloseRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const activeAIAction = aiState.status === 'idle' ? undefined : aiState.action

  return (
    <>
      <div ref={scopeRef} className={`selection-scope ${className}`.trim()}>{children}</div>
      <span className="visually-hidden" role="status" aria-live="polite">{selectionAnnouncement}</span>
      {toolbar && createPortal(
        <>
        <div
          ref={toolbarRef}
          className="selection-toolbar"
          role="toolbar"
          aria-label={`Actions for selected text: ${toolbar.text.slice(0, 80)}`}
          aria-describedby="selection-toolbar-help"
          style={{ top: position?.top ?? -1000, left: position?.left ?? -1000, visibility: position ? 'visible' : 'hidden' }}
          onPointerDown={() => { preserveSelectionRef.current = true }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              clearSelection()
            }
          }}
        >
          {AI_ACTIONS.map(({ action, label }) => <button key={action} ref={(element) => { aiActionButtonsRef.current[action] = element }} type="button" onClick={(event) => { lastActionTriggerRef.current = event.currentTarget; void runAI(action) }} disabled={aiState.status === 'loading'}>{label}</button>)}
          <button type="button" onClick={saveSelected} aria-label="Save selected French text locally">Save</button>
          {mobileViewport && mobileSheetDismissed && activeAIAction && <button className="selection-toolbar-view-results" type="button" onClick={() => { lastActionTriggerRef.current = aiActionButtonsRef.current[activeAIAction] ?? null; setMobileSheetDismissed(false) }} aria-label={`Reopen ${ACTION_LABELS[activeAIAction]} result`}>View result</button>}
          <span id="selection-toolbar-help" className="selection-toolbar-help">Translate, Explain, Grammar, and Example use selected text. Grammar may include short nearby context. Groq is primary; Gemini may be used if Groq is temporarily unavailable. Save keeps this selection on this device.</span>
          {aiState.status === 'loading' && <span className="selection-toolbar-status selection-ai-inline" role="status" aria-live="polite">{aiState.action === 'translate' ? 'Translating selected text…' : aiState.action === 'explain' ? 'Preparing an explanation…' : aiState.action === 'grammar' ? 'Checking the grammar…' : 'Writing an example…'}</span>}
          {aiState.status === 'success' && <div className="selection-toolbar-result selection-ai-inline" role="status" aria-live="polite"><strong>{ACTION_LABELS[aiState.action]}</strong><p>{aiState.result}</p>{aiState.usedBackup && <small>Backup provider used.</small>}</div>}
          {aiState.status === 'error' && <div className="selection-toolbar-error selection-ai-inline" role="alert"><strong>{ACTION_LABELS[aiState.action]}</strong><p>{aiState.message}</p>{aiState.retryable && <button type="button" onClick={() => void runAI(aiState.action)}>Try again</button>}</div>}
          {Object.entries(results).map(([action, result]) => action !== activeAIAction && result && <div key={action} className="selection-toolbar-result selection-ai-inline"><strong>{ACTION_LABELS[action as AIAction]}</strong><p>{result}</p></div>)}
          {saveMessage && <span className={saveMessage.kind === 'error' ? 'selection-toolbar-error' : 'selection-toolbar-status'} role={saveMessage.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{saveMessage.text}</span>}
        </div>
        {mobileDialogOpen && <div ref={sheetBackdropRef} className="ai-sheet-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeMobileDialog() }}>
          <section ref={mobileDialogRef} className="ai-result-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-result-title" onKeyDown={handleDialogKeyDown}>
            <header className="ai-result-sheet-heading">
              <div><p className="eyebrow"><span className="eyebrow-dot" /> FRANÇAISLAB STUDY NOTE</p><h2 id="ai-result-title">{activeAIAction ? ACTION_LABELS[activeAIAction] : 'Study note'}</h2></div>
              <button ref={mobileCloseRef} className="ai-sheet-close" type="button" onClick={closeMobileDialog} aria-label="Close AI result">×</button>
            </header>
            {aiState.status === 'loading' && <p className="ai-sheet-status" role="status" aria-live="polite">{aiState.action === 'translate' ? 'Translating selected text…' : aiState.action === 'explain' ? 'Preparing an explanation…' : aiState.action === 'grammar' ? 'Checking the grammar…' : 'Writing an example…'}</p>}
            {aiState.status === 'success' && <div className="ai-sheet-content" role="status" aria-live="polite"><p>{aiState.result}</p>{aiState.usedBackup && <small>Backup provider used.</small>}</div>}
            {aiState.status === 'error' && <div className="ai-sheet-content" role="alert"><p>{aiState.message}</p>{aiState.retryable && <button className="button button-secondary" type="button" onClick={() => void runAI(aiState.action)}>Try again</button>}</div>}
            {Object.entries(results).map(([action, result]) => action !== activeAIAction && result && <section key={action} className="ai-sheet-previous-result"><h3>{ACTION_LABELS[action as AIAction]}</h3><p>{result}</p></section>)}
          </section>
        </div>}
        </>,
        document.body,
      )}
    </>
  )
}
