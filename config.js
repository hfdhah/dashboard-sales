// config.js
const CONFIG = {
  AI_PROVIDER: 'groq',
  get GROQ_API_KEY() {
    return sessionStorage.getItem('groq_api_key') || '';
  },
  GROQ_URL:   'https://api.groq.com/openai/v1/chat/completions',
  GROQ_MODEL: 'llama-3.1-8b-instant',
  LANGUAGE:   'Indonesian'
};