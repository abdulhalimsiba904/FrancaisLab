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

`npm run preview` is for frontend-only local preview. For the combined production server, use the production flow below.

The browser regression uses Playwright with Chromium. Install its browser once with `npx playwright install chromium`, then run `npm run test:e2e`. It generates tiny synthetic two-page PDF and two-slide PPTX fixtures in a temporary directory, removes them after the run, and intercepts `POST /api/ai` with deterministic mocked responses. It does not start the API server or contact Groq/Gemini. The browser suite covers reading, selection, mocked actions, local saves, source return, refresh recovery, mobile dialog focus, and narrow layouts.

## Production server

The Node server serves the built `dist` frontend and `/api/ai` from one origin. Direct visits to `/`, `/reader`, and `/saved` return the SPA entry point; missing assets and unknown `/api` routes return 404 instead of the SPA. API responses remain JSON and selected text is not logged or stored.

For a production build and start:

```sh
npm ci
npm run build
npm start
```

Set `NODE_ENV=production` and the server-side `GROQ_API_KEY` in the host's secret settings; set `GEMINI_API_KEY` only if you want the optional fallback. The service listens on `0.0.0.0` and uses the host-provided `PORT` (local fallback `3001`). Do not pass provider keys through `VITE_` variables or frontend build settings. `npm start` expects `npm run build` to have created `dist`.

## Vercel deployment foundation

The project is configured as a Vite app with a Node.js Function at `api/ai.js`. Vercel's file-based function routing maps that file to `/api/ai`; the Vite output in `dist` serves the app, and explicit rewrites return `index.html` for direct `/reader` and `/saved` navigation. There is no broad catch-all rewrite, so other `/api/*` paths are not sent to the SPA. `api/ai.js` calls the same shared request handler, validation, provider factory, and Groq-to-Gemini failover as the standalone Node server.

In the Vercel project dashboard, open **Settings → Environment Variables** and add `GROQ_API_KEY`, selecting **Preview** for preview deployments (and Production only when ready for production). Add `GEMINI_API_KEY` the same way only to enable the optional fallback. Optionally set `GROQ_MODEL`, `GEMINI_MODEL`, and `ALLOWED_ORIGINS`. Save the values and create a new deployment so the function receives them. Do not add provider keys as `VITE_` variables, commit them in `vercel.json`, or use a local `.env` file for Vercel. See Vercel's [environment variable documentation](https://vercel.com/docs/environment-variables).

Vercel terminates HTTPS and documents `host` and `x-forwarded-proto` as request headers; the function uses those platform request values for its default same-origin check. It does not use `TRUST_PROXY_HOPS` or derive a client address from caller-controlled forwarding headers. The standalone Node server keeps its explicit local proxy-hop configuration. The function deliberately does not use the app's in-memory rate limiter: serverless invocations can run in separate, short-lived instances, so their counters are not shared and cannot enforce a reliable cross-instance quota. Vercel's [WAF rate-limiting rules](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) are available on all plans and can limit matching traffic at the edge; Vercel documents their counters as per-region, so they can exceed a configured threshold across regions and are not a global application quota. Review current included usage/pricing and configure a `/api/ai` rule in the dashboard if appropriate; no external rate-limit service is included.

To configure that edge protection, open **Project → Firewall**, add a custom rule matching `/api/ai` and the `POST` method, select a fixed-window threshold and the default 429 action, then review and publish it. Check current usage/pricing when setting the threshold.

Review the current [Vite deployment guide](https://vercel.com/docs/frameworks/frontend/vite), [Node.js Functions documentation](https://vercel.com/docs/functions/runtimes/node-js), [project rewrites configuration](https://vercel.com/docs/project-configuration/vercel-json), and [request headers](https://vercel.com/docs/headers/request-headers) before deploying. No hosting account or deployment configuration is part of this step.

### API abuse and origin settings

`POST /api/ai` has a fixed-window in-memory limit of 20 requests per observed client address per 60 seconds. With the default proxy trust setting, the observed address is the direct socket peer; configure `TRUST_PROXY_HOPS` for the client address when a trusted proxy is present. Configure `AI_RATE_LIMIT_MAX` and `AI_RATE_LIMIT_WINDOW_MS` on the server if needed. Excess requests receive HTTP 429 and a `Retry-After` header. This is a basic V1 safeguard: its counters are per process, reset on restart, and are not shared across multiple service instances.

Same-origin browser requests are allowed by default. Requests carrying a different `Origin` are rejected. `ALLOWED_ORIGINS` optionally accepts a comma-separated list of exact origins for explicit deployments; it only controls this origin check and does not enable cross-origin browser access or add CORS headers.

Forwarded client IP headers are ignored by default. Set `TRUST_PROXY_HOPS` to the fixed number of trusted proxies in front of the service only when the deployment proxy overwrites/normalizes `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` and the app cannot be reached directly around that proxy. The server selects the client address by walking that configured number of entries from the right side of `X-Forwarded-For`. Leave the setting at `0` if that proxy behavior is not guaranteed; then rate limiting uses the direct socket peer address.

## Selection actions and saved French

The Vercel function adapter is covered by mocked Node tests in `server/vercelFunction.test.js`; those tests use mock provider objects and never make provider requests.

The API accepts `translate`, `explain`, `grammar`, and `example`. Translation and Example send selected text only. Explain and Grammar may include up to 320 characters of nearby text. The selected document is never sent. The local API does not log or persist selections, provider requests, or responses.

Groq is primary. Gemini is optional and is used only when Groq has a transient failure such as a rate limit, timeout, or service error. Permanent key, model, and client request errors do not trigger failover. If Groq is not configured but Gemini is, Gemini can answer directly. With neither key configured, the reader shows a setup message. Requests are attempted once per provider.

Using Translate, Explain, Grammar, or Example sends selected text to Groq when configured and may also send it to Gemini if Groq is temporarily unavailable. Explain and Grammar may include short nearby context. If only Gemini is configured, it receives the selection directly. Google’s unpaid Gemini API terms differ from Groq’s: Google may use prompts and responses from unpaid services to improve its products and machine-learning technologies, while Groq says inference data is not retained by default but may be temporarily logged for reliability or abuse monitoring. Review the current [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [Groq data handling](https://console.groq.com/docs/your-data) before use.

Use Save to keep the selected French text and any generated translation, explanation, grammar note, or example in this browser's local storage. Saved entries include the source document name, current page or slide when available, and save time. They stay on this device and are not uploaded or synced. The PDF/PPTX file itself is never stored. Delete entries from **My Saved French**. If browser storage is unavailable or full, FrançaisLab shows an error and keeps the document local.

Free quotas, model availability, and provider service availability can change. Check the providers' current model and quota documentation before relying on a model.

## Document rendering limitations

- **PDF:** React-PDF uses Mozilla PDF.js and provides page navigation, zoom, and selectable PDF text. Image-only pages have no selectable text; FrançaisLab V1 does not include OCR.
- **PowerPoint:** JSZip reads `.pptx` files in the browser and renders slide text as selectable HTML. The text-focused view does not reproduce slide images, layout, animation, or complex formatting. OCR is not included.
