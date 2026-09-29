# FrançaisLab

A focused study reader for university students learning French. Select a local course PDF or PowerPoint slide deck, then select text to translate, explain, study its grammar, create an example, or save it locally.

## Setup

Use Node.js 20 or newer. Install dependencies and create a private local environment file:

```sh
npm install
Copy-Item .env.example .env
```

Add your server-side keys to `.env`:

```dotenv
GROQ_API_KEY=
GEMINI_API_KEY=
```

Create a Groq key in the [Groq Console](https://console.groq.com/keys). Groq is required for the primary provider. Gemini is optional; create a key in [Google AI Studio](https://aistudio.google.com/app/apikey) to enable it as a fallback. `.env` is ignored by Git, while `.env.example` contains blank placeholders only. Never put keys in frontend code or `VITE_` variables.

Optional model overrides are `GROQ_MODEL` and `GEMINI_MODEL`. Defaults are `openai/gpt-oss-20b` and `gemini-3.8-flash`, respectively. The Gemini adapter uses Google's documented server-side `generateContent` HTTP API with the API key in a request header; it adds no provider SDK dependency.

## Development and verification

Start the API and Vite frontend together:

```sh
npm run dev
```

Vite proxies `/api` requests to the independent Node server on `127.0.0.1:3001`. The API reads `.env`; the Vite child process does not inherit provider-key variables. Use `npm run dev:api` or `npm run dev:web` to start one process separately.

```sh
npm test
npm run test:e2e
npm run build
npm run preview
```

`npm run preview` serves the built frontend only; Vite's `/api` proxy is a development feature.

The browser regression uses Playwright with Chromium. Install its browser once with `npx playwright install chromium`, then run `npm run test:e2e`. It generates tiny synthetic two-page PDF and two-slide PPTX fixtures in a temporary directory, removes them after the run, and intercepts `POST /api/ai` with deterministic mocked responses. It does not start the API server or contact Groq/Gemini. The browser suite covers reading, selection, mocked actions, local saves, source return, refresh recovery, mobile dialog focus, and narrow layouts.

## Selection actions and saved French

The API accepts `translate`, `explain`, `grammar`, and `example`. Translation and Example send selected text only. Explain and Grammar may include up to 320 characters of nearby text. The selected document is never sent. The local API does not log or persist selections, provider requests, or responses.

Groq is primary. Gemini is optional and is used only when Groq has a transient failure such as a rate limit, timeout, or service error. Permanent key, model, and client request errors do not trigger failover. If Groq is not configured but Gemini is, Gemini can answer directly. With neither key configured, the reader shows a setup message. Requests are attempted once per provider.

Using Translate, Explain, Grammar, or Example sends selected text to Groq when configured and may also send it to Gemini if Groq is temporarily unavailable. Explain and Grammar may include short nearby context. If only Gemini is configured, it receives the selection directly. Google’s unpaid Gemini API terms differ from Groq’s: Google may use prompts and responses from unpaid services to improve its products and machine-learning technologies, while Groq says inference data is not retained by default but may be temporarily logged for reliability or abuse monitoring. Review the current [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [Groq data handling](https://console.groq.com/docs/your-data) before use.

Use Save to keep the selected French text and any generated translation, explanation, grammar note, or example in this browser's local storage. Saved entries include the source document name, current page or slide when available, and save time. They stay on this device and are not uploaded or synced. The PDF/PPTX file itself is never stored. Delete entries from **My Saved French**. If browser storage is unavailable or full, FrançaisLab shows an error and keeps the document local.

Free quotas, model availability, and provider service availability can change. Check the providers' current model and quota documentation before relying on a model.

## Document rendering limitations

- **PDF:** React-PDF uses Mozilla PDF.js and provides page navigation, zoom, and selectable PDF text. Image-only pages have no selectable text; FrançaisLab V1 does not include OCR.
- **PowerPoint:** JSZip reads `.pptx` files in the browser and renders slide text as selectable HTML. The text-focused view does not reproduce slide images, layout, animation, or complex formatting. OCR is not included.
