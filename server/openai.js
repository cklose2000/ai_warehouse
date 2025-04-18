// server/openai.js
// Utility to embed text using OpenAI API
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fetch = require('node-fetch');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-ada-002';

async function embedText(text) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: text,
      model: OPENAI_EMBEDDING_MODEL,
    })
  });
  if (!res.ok) throw new Error(`OpenAI Embedding error: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

module.exports = { embedText };
