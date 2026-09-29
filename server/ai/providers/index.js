import { createGeminiProvider } from './gemini.js'
import { createGroqProvider } from './groq.js'

export function createProviders(env = process.env) {
  return {
    groq: createGroqProvider(env),
    gemini: createGeminiProvider(env),
  }
}
