import { requestChatCompletion } from './chatCompletion.js'

export function createGroqProvider(env) {
  const apiKey = env.GROQ_API_KEY?.trim() ?? ''
  return {
    name: 'Groq',
    apiKey,
    async complete({ messages, maxTokens }) {
      return requestChatCompletion({
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey,
        model: env.GROQ_MODEL?.trim() || 'openai/gpt-oss-20b',
        messages,
        maxTokens,
      })
    },
  }
}
