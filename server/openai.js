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

// Patch chatWithOpenAI to support image input (OpenAI Vision)
async function chatWithOpenAI(systemPrompt, message, chatHistory = [], editorContents = '', sampledResults = '', imageData = null) {
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
  let userContent = message;
  if (editorContents) userContent += `\n\nSQL Editor Contents:\n${editorContents}`;
  if (sampledResults) userContent += `\n\nSampled Results:\n${sampledResults}`;
  let userMessage;
  if (imageData) {
    userMessage = {
      role: 'user',
      content: [
        { type: 'text', text: userContent },
        { type: 'image_url', image_url: { url: `data:${imageData.mimetype};base64,${imageData.base64}` } }
      ]
    };
    console.log('[AI-CHAT] Vision payload: user message contains image:', {
      mimetype: imageData.mimetype,
      filename: imageData.originalname,
      size: imageData.buffer.length
    });
  } else {
    userMessage = { role: 'user', content: userContent };
  }
  messages.push(userMessage);

  // Log the full payload sent to OpenAI
  console.log('[AI-CHAT] Sending payload to OpenAI:', JSON.stringify({ model: OPENAI_MODEL, messages }, null, 2));

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
  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error('[AI-CHAT] Failed to parse OpenAI response:', err);
    throw err;
  }
  // Log the full OpenAI response
  console.log('[AI-CHAT] OpenAI response:', JSON.stringify(data, null, 2));
  if (!res.ok) {
    throw new Error(`OpenAI Chat error: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.choices[0].message.content;
}

module.exports = { embedText, chatWithOpenAI };
