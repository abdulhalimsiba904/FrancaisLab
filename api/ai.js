import { handleAIEndpoint } from '../server/ai/http.js'
import { createProviders } from '../server/ai/providers/index.js'
import { parseAllowedOrigins } from '../server/config.js'

export function createVercelAIHandler({
  providers = createProviders(process.env),
  allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
} = {}) {
  return (request, response) => handleAIEndpoint(request, response, {
    providers,
    allowedOrigins,
    // Vercel terminates TLS and supplies these platform request headers. Do not
    // derive client identity from X-Forwarded-For in this serverless function.
    originContext: (req) => ({
      host: req.headers.host,
      protocol: req.headers['x-forwarded-proto']
        ? `${String(req.headers['x-forwarded-proto']).split(',')[0].trim().toLowerCase()}:`
        : req.socket?.encrypted ? 'https:' : 'http:',
    }),
    // The local in-memory limiter is intentionally omitted: function instances
    // are ephemeral and do not share counters.
  })
}

export default createVercelAIHandler()
