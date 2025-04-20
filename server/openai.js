// server/openai.js
// Utility to embed text and chat using OpenAI API
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fetch = require('node-fetch');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-ada-002';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-2025-04-14';

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

async function chatWithOpenAI(systemPrompt, message, chatHistory = [], editorContents = '', sampledResults = '') {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  if (Array.isArray(chatHistory) && chatHistory.length > 0) {
    for (const msg of chatHistory) {
      if (msg.role && msg.content) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }
  // Add user message and context
  let userContent = message;
  if (editorContents) userContent += `\n\nSQL Editor Contents:\n${editorContents}`;
  if (sampledResults) userContent += `\n\nSampled Results:\n${sampledResults}`;
  messages.push({ role: 'user', content: userContent });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.2,
    })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`OpenAI Chat error: ${res.status} ${errData.error?.message || ''}`);
  }
  const data = await res.json();
  return data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    ? data.choices[0].message.content
    : '';
}

module.exports = { embedText, chatWithOpenAI };
