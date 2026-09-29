import { test, expect } from '@playwright/test'
import JSZip from 'jszip'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let fixtureDirectory
let pdfFixture
let pptxFixture
let mismatchFixture

function makePdf() {
  const lines = [
    ['Le journal quotidien aide les etudiants.', 'Elle lit le journal dans le jardin.'],
    ['Nous etudions le francais avec plaisir.', 'Le vocabulaire enrichit la discussion.'],
  ]
  const stream = (pageLines) => pageLines.map((line, index) =>
    `BT /F1 18 Tf 72 ${720 - index * 34} Td (${line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')}) Tj ET`,
  ).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    null,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  for (const [objectIndex, contentIndex, pageIndex] of [[3, 4, 0], [5, 6, 1]]) {
    const content = stream(lines[pageIndex])
    objects[contentIndex - 1] = `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`
  }

  let output = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output, 'ascii'))
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(output, 'ascii')
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(output, 'ascii')
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

async function makePptx() {
  const zip = new JSZip()
  const relsNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const officeRelNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const pNs = 'http://schemas.openxmlformats.org/presentationml/2006/main'
  const aNs = 'http://schemas.openxmlformats.org/drawingml/2006/main'
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="${pNs}" xmlns:r="${officeRelNs}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${relsNs}"><Relationship Id="rId1" Type="${officeRelNs}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${officeRelNs}/slide" Target="slides/slide2.xml"/></Relationships>`)
  const slides = [
    ['Le café est délicieux.', 'Je partage un repas avec mes amis.'],
    ['Nous apprenons le français ensemble.', 'La classe commence à neuf heures.'],
  ]
  slides.forEach((paragraphs, index) => {
    const content = paragraphs.map((line) => `<a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`).join('')
    zip.file(`ppt/slides/slide${index + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="${pNs}" xmlns:a="${aNs}"><p:cSld><p:spTree><p:sp><p:txBody>${content}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`)
  })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

test.beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'francaislab-e2e-'))
  pdfFixture = join(fixtureDirectory, 'synthetic-course.pdf')
  pptxFixture = join(fixtureDirectory, 'synthetic-slides.pptx')
  mismatchFixture = join(fixtureDirectory, 'different-name.pdf')
  await writeFile(pdfFixture, makePdf())
  await writeFile(pptxFixture, await makePptx())
  await writeFile(mismatchFixture, makePdf())
})

test.afterAll(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true })
})

function installAiMock(page, { failAction } = {}) {
  const calls = []
  const attempts = new Map()
  page.route('**/api/ai', async (route) => {
    const body = route.request().postDataJSON()
    calls.push(body)
    const count = (attempts.get(body.action) ?? 0) + 1
    attempts.set(body.action, count)
    if (body.action === failAction && count === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Temporary mock failure. Please retry.', retryable: true } }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: `Mock ${body.action}: ${body.text}`, usedBackup: false }),
    })
  })
  return calls
}

async function openFixture(page, fixture) {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(page.locator('.reader-viewer')).toBeVisible()
  await expect(page.locator('.pptx-slide, .react-pdf__Page__textContent').first()).toBeVisible()
}

async function selectText(page, scopeSelector, phrase) {
  await page.evaluate(({ selector, text }) => {
    const scope = document.querySelector(selector)
    if (!scope) throw new Error(`Selection scope not found: ${selector}`)
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const offset = node.textContent?.indexOf(text) ?? -1
      if (offset < 0) continue
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + text.length)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    throw new Error(`Text not found in reader: ${text}`)
  }, { selector: scopeSelector, text: phrase })
  await expect(page.getByRole('toolbar', { name: new RegExp(`Actions for selected text: ${phrase}`) })).toBeVisible()
}

async function getSavedItem(page, frenchText) {
  const card = page.locator('.saved-card').filter({ hasText: frenchText }).first()
  await expect(card).toBeVisible()
  return card
}

test('PDF: page navigation, scoped AI payloads, save/reload/delete, and same-session return', async ({ page }) => {
  const calls = installAiMock(page)
  const providerRequests = []
  page.on('request', (request) => {
    if (/api\.groq\.com|generativelanguage\.googleapis\.com/i.test(request.url())) providerRequests.push(request.url())
  })
  await openFixture(page, pdfFixture)

  await expect(page.getByText('Page 1 of 2')).toBeVisible()
  await expect(page.locator('.react-pdf__Page__textContent')).toBeVisible()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByText('Page 2 of 2')).toBeVisible()
  await page.getByRole('button', { name: 'Previous page' }).click()
  await expect(page.getByText('Page 1 of 2')).toBeVisible()

  await selectText(page, '.pdf-selection-scope', 'quotidien')
  const toolbar = page.getByRole('toolbar', { name: /Actions for selected text: quotidien/ })
  await expect(toolbar).toBeVisible()

  for (const [action, button, hasContext] of [
    ['translate', 'Translate', false],
    ['explain', 'Explain', true],
    ['grammar', 'Grammar', true],
    ['example', 'Example', false],
  ]) {
    const actionButton = toolbar.getByRole('button', { name: button, exact: true })
    if (action === 'translate') {
      await actionButton.focus()
      await actionButton.press('Enter')
    } else {
      await actionButton.click()
    }
    await expect(toolbar.getByText(`Mock ${action}: quotidien`)).toBeVisible()
    const call = calls.at(-1)
    expect(call.action).toBe(action)
    expect(call.text).toBe('quotidien')
    expect(JSON.stringify(call)).not.toContain('Nous etudions le francais')
    if (hasContext) {
      expect(call.context).toContain('journal')
      expect(call.context.length).toBeLessThanOrEqual(320)
    } else {
      expect(call.context).toBeUndefined()
    }
    await expect(page.getByText('Page 1 of 2')).toBeVisible()
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('quotidien')
  }

  await toolbar.getByRole('button', { name: 'Save selected French text locally' }).click()
  await expect(page.getByText('Saved on this device.')).toBeVisible()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('francaislab.saved.v1') ?? '[]'))
  expect(stored).toHaveLength(1)
  expect(stored[0]).toMatchObject({ text: 'quotidien', sourceName: 'synthetic-course.pdf', sourcePosition: { label: 'Page', number: 1 } })
  expect(stored[0].sourceDocumentId).toBeTruthy()
  expect(stored[0].results).toEqual({
    translate: 'Mock translate: quotidien',
    explain: 'Mock explain: quotidien',
    grammar: 'Mock grammar: quotidien',
    example: 'Mock example: quotidien',
  })

  await page.getByRole('link', { name: 'My Saved French' }).click()
  const card = await getSavedItem(page, 'quotidien')
  await expect(card).toContainText('Translation')
  await expect(card).toContainText('synthetic-course.pdf · Page 1')
  await page.getByRole('button', { name: /Open source · Page 1/ }).click()
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
  await expect(page.locator('.react-pdf__Page__textContent')).toContainText('Le journal quotidien')

  await page.getByRole('link', { name: 'My Saved French' }).click()
  await page.reload()
  await expect(await getSavedItem(page, 'quotidien')).toContainText('Mock grammar: quotidien')
  await page.getByRole('button', { name: /Delete saved French item: quotidien/ }).click()
  await expect(page.getByText('No saved French yet')).toBeVisible()
  expect(providerRequests).toEqual([])
})

test('PPTX: selectable slide text, no-result save, AI save, and same-session slide return', async ({ page }) => {
  const calls = installAiMock(page)
  await openFixture(page, pptxFixture)
  await expect(page.getByText('Slide 1 of 2')).toBeVisible()
  await expect(page.locator('.pptx-slide')).toContainText('Le café est délicieux.')
  await page.getByRole('button', { name: 'Next slide' }).click()
  await expect(page.getByText('Slide 2 of 2')).toBeVisible()
  await expect(page.locator('.pptx-slide')).toContainText('Nous apprenons le français ensemble.')

  await selectText(page, '.pptx-slide', 'français')
  const toolbar = page.getByRole('toolbar', { name: /Actions for selected text: français/ })
  await toolbar.getByRole('button', { name: 'Save selected French text locally' }).click()
  await expect(page.getByText('Saved on this device.')).toBeVisible()
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('francaislab.saved.v1') ?? '[]'))
  expect(stored[0]).toMatchObject({ text: 'français', sourceName: 'synthetic-slides.pptx', sourcePosition: { label: 'Slide', number: 2 }, results: {} })

  await toolbar.getByRole('button', { name: 'Example', exact: true }).click()
  await expect(toolbar.getByText('Mock example: français')).toBeVisible()
  expect(calls.at(-1)).toEqual({ action: 'example', text: 'français' })
  await toolbar.getByRole('button', { name: 'Save selected French text locally' }).click()
  await expect(page.getByText('Saved on this device.')).toBeVisible()

  await page.getByRole('link', { name: 'My Saved French' }).click()
  const cards = page.locator('.saved-card')
  await expect(cards).toHaveCount(2)
  await expect(page.getByText(/synthetic-slides\.pptx · Slide 2/).first()).toBeVisible()
  await page.getByRole('button', { name: /Open source · Slide 2/ }).first().click()
  await expect(page.getByText('Slide 2 of 2')).toBeVisible()
  await expect(page.locator('.pptx-slide')).toContainText('Nous apprenons le français ensemble.')
  await page.getByRole('link', { name: 'My Saved French' }).click()
  await page.reload()
  await expect(page.locator('.saved-card')).toHaveCount(2)
  await expect(page.locator('.saved-card').filter({ hasText: 'français' }).first()).toContainText('Mock example: français')
  await expect(page.locator('.saved-card').filter({ hasText: 'français' }).last()).not.toContainText('Example')
})

test('refreshed source return rejects another filename and reports missing/out-of-range locations', async ({ page }) => {
  const savedItem = (overrides) => ({
    id: 'synthetic-return-item',
    text: 'quotidien',
    results: {},
    sourceName: 'synthetic-course.pdf',
    sourceDocumentId: 'previous-session-document',
    savedAt: '2026-09-28T12:00:00.000Z',
    ...overrides,
  })
  await page.goto('/')
  await page.evaluate((items) => localStorage.setItem('francaislab.saved.v1', JSON.stringify(items)), [savedItem({ sourcePosition: { label: 'Page', number: 88 } })])
  await page.goto('/saved')
  await expect(page.getByText('Source files stay in memory for this app session.')).toBeVisible()
  await page.getByRole('button', { name: 'Open source · choose file' }).click()
  const input = page.locator('.saved-card input[type="file"]')
  await input.setInputFiles(mismatchFixture)
  await expect(page.getByRole('alert')).toContainText('Choose the original file named “synthetic-course.pdf”')
  await input.setInputFiles(pdfFixture)
  await expect(page.getByText('Saved page 88 is not in this PDF. Showing its last page, 2.')).toBeVisible()
  await expect(page.getByText('Page 2 of 2')).toBeVisible()

  await page.goto('/saved')
  await page.evaluate(() => localStorage.setItem('francaislab.saved.v1', JSON.stringify([{
    id: 'missing-location', text: 'quotidien', results: {}, sourceName: 'synthetic-course.pdf',
    sourceDocumentId: 'expired-session-id', savedAt: '2026-09-28T12:01:00.000Z',
  }])))
  await page.reload()
  await page.getByRole('button', { name: 'Open source · choose file' }).click()
  await page.locator('.saved-card input[type="file"]').setInputFiles(pdfFixture)
  await expect(page.getByRole('heading', { name: 'synthetic-course.pdf' })).toBeVisible()
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
  await expect(page.getByText(/no usable page or slide location/)).toBeVisible()
})

test('mobile reader has no horizontal overflow; result sheet traps focus, restores focus, and reports errors', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  installAiMock(page, { failAction: 'grammar' })
  await openFixture(page, pptxFixture)
  await expect(page.getByText('Slide 1 of 2')).toBeVisible()
  await selectText(page, '.pptx-slide', 'délicieux')
  const toolbar = page.getByRole('toolbar', { name: /Actions for selected text: délicieux/ })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const translateButton = toolbar.getByRole('button', { name: 'Translate', exact: true })
  await translateButton.click()
  const dialog = page.getByRole('dialog', { name: 'Translation' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Mock translate: délicieux' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close AI result' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Close AI result' })).toBeFocused()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('délicieux')
  await expect(page.getByText('Slide 1 of 2')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close AI result' }).click()
  await expect(translateButton).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const viewResults = toolbar.getByRole('button', { name: 'Reopen Translation result' })
  await viewResults.click()
  await expect(page.getByRole('dialog', { name: 'Translation' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(translateButton).toBeFocused()

  await toolbar.getByRole('button', { name: 'Grammar', exact: true }).click()
  const grammarDialog = page.getByRole('dialog', { name: 'Grammar note' })
  await expect(grammarDialog.getByRole('alert')).toContainText('Temporary mock failure. Please retry.')
  await expect(grammarDialog.getByRole('button', { name: 'Close AI result' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(grammarDialog.getByRole('button', { name: 'Try again' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(grammarDialog.getByRole('button', { name: 'Close AI result' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(grammarDialog.getByRole('button', { name: 'Try again' })).toBeFocused()
  await grammarDialog.getByRole('button', { name: 'Try again' }).click()
  await expect(grammarDialog.getByText('Mock grammar: délicieux')).toBeVisible()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('délicieux')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const colorChecks = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    const closeButton = document.querySelector('.ai-result-sheet .ai-sheet-close')
    closeButton?.focus()
    const focusedButton = closeButton
    return {
      brandSoft: style.getPropertyValue('--green-soft').trim(),
      outlineColor: focusedButton ? getComputedStyle(focusedButton).outlineColor : '',
      liveRegions: [...document.querySelectorAll('[aria-live]')].length,
    }
  })
  expect(colorChecks.brandSoft).toBe('#e5f0e3')
  expect(colorChecks.outlineColor).toBe('rgb(37, 78, 64)')
  const contrastRatio = (foreground, background) => {
    const luminance = (hex) => {
      const channels = hex.match(/[a-f0-9]{2}/giu).map((channel) => parseInt(channel, 16) / 255)
        .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    return (values[0] + 0.05) / (values[1] + 0.05)
  }
  expect(contrastRatio('#254e40', '#fbfdf9')).toBeGreaterThan(3)
  expect(colorChecks.liveRegions).toBeGreaterThan(0)
})

test('localStorage write failures are announced accessibly', async ({ page }) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'francaislab.saved.v1') throw new DOMException('synthetic quota error', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    }
  })
  await openFixture(page, pptxFixture)
  await selectText(page, '.pptx-slide', 'délicieux')
  await page.getByRole('toolbar').getByRole('button', { name: 'Save selected French text locally' }).click()
  await expect(page.getByRole('alert')).toContainText('Browser storage is unavailable or full')
})

test('reader controls, labels, focus styling, and saved layout remain usable at narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await openFixture(page, pdfFixture)
  await expect(page.getByRole('group', { name: 'PDF reader controls' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Page navigation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 360)
  await page.getByRole('link', { name: 'My Saved French' }).click()
  await expect(page.getByText('No saved French yet')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.keyboard.press('Tab')
  const activeFocus = await page.evaluate(() => ({
    text: document.activeElement?.textContent?.trim(),
    outline: getComputedStyle(document.activeElement).outlineColor,
    width: document.documentElement.scrollWidth,
  }))
  expect(activeFocus.outline).toMatch(/rgb\(/)
  expect(activeFocus.width).toBeLessThanOrEqual(360)
})
