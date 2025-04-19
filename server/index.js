// server/index.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fetch = require('node-fetch');
const { embedText } = require('./openai');
const fs = require('fs');
const path = require('path');
const SYSTEM_PROMPT_PATH = path.join(__dirname, '../system_prompt.txt');

function getSystemPrompt(formattedSchema, editorContents = '', sampledResults = '') {
  let promptTemplate = '';
  try {
    promptTemplate = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
  } catch (e) {
    console.error('Failed to read system_prompt.txt, using default prompt.');
    promptTemplate = [
      'YOU ARE AN EXPERT AI DBA AND SQL ASSISTANT.',
      'Try to help the user with their questions based on your awareness of the schema_embeddings vector.',
      '',
      '**IMPORTANT: If you provide SQL statements, ALWAYS put ALL statements in a single triple-backtick SQL code block, like this:**',
      '```sql',
      '<your SQL statements here>',
      '```',
      '',
      'SCHEMA:',
      '{SCHEMA}',
      '',
      '---',
      'The user\'s current SQL editor contents:',
      '{EDITOR_CONTENTS}',
      '',
      'Sampled results from recent queries:',
      '{SAMPLED_RESULTS}',
      '---',
    ].join('\n');
  }
  // Replace placeholders with actual content
  return promptTemplate
    .replace(/SCHEMA:$/i, 'SCHEMA:\n' + formattedSchema)
    .replace(/{SCHEMA}/g, formattedSchema)
    .replace(/{EDITOR_CONTENTS}/g, editorContents)
    .replace(/{SAMPLED_RESULTS}/g, sampledResults);
}

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Set up Postgres connection pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Utility: Insert chat history log
async function logChatHistory({ started_at, ended_at, user_id, agent_id, session_id, prompt, response, tags, context, rating, source }) {
  try {
    await pool.query(
      `INSERT INTO chat_history (started_at, ended_at, user_id, agent_id, session_id, prompt, response, tags, context, rating, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [started_at, ended_at, user_id, agent_id, session_id, prompt, response, tags, context, rating, source]
    );
  } catch (e) {
    console.error('[LOGGING] Failed to log chat_history:', e);
  }
}

// Utility: Insert query history log
async function logQueryHistory({ executed_at, user_id, session_id, query_text, status, error_message, tags, duration_ms, result_sample }) {
  try {
    await pool.query(
      `INSERT INTO query_history (executed_at, user_id, session_id, query_text, status, error_message, tags, duration_ms, result_sample)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [executed_at, user_id, session_id, query_text, status, error_message, tags, duration_ms, result_sample]
    );
  } catch (e) {
    console.error('[LOGGING] Failed to log query_history:', e);
  }
}

// Query endpoint with row limit
app.post('/api/query', async (req, res) => {
  let { sql, rowLimit, user_id, session_id, tags } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'SQL required' });
  }
  rowLimit = Math.max(1, Math.min(parseInt(rowLimit || 1000, 10), 100000));
  let sqlToRun = sql.trim();
  if (/^select/i.test(sqlToRun) && !/limit\s+\d+$/i.test(sqlToRun)) {
    sqlToRun += ` LIMIT ${rowLimit}`;
  }
  const start = Date.now();
  let status = 'success', error_message = null, result_sample = null;
  try {
    const result = await pool.query(sqlToRun);
    // Sample first row as JSON string (for preview)
    result_sample = result.rows && result.rows[0] ? JSON.stringify(result.rows[0]).slice(0, 500) : null;
    res.json({ rows: result.rows, fields: result.fields, rowLimit });
    await logQueryHistory({
      executed_at: new Date(),
      user_id,
      session_id,
      query_text: sqlToRun,
      status,
      error_message,
      tags,
      duration_ms: Date.now() - start,
      result_sample
    });
  } catch (err) {
    status = 'error';
    error_message = err.message || 'Unknown error';
    console.error('Query error:', err);
    res.status(400).json({ error: error_message, details: err });
    await logQueryHistory({
      executed_at: new Date(),
      user_id,
      session_id,
      query_text: sqlToRun,
      status,
      error_message,
      tags,
      duration_ms: Date.now() - start,
      result_sample
    });
  }
});

// Object explorer endpoint: fetch tables with comments, grouped by comment
app.get('/api/object-explorer', async (req, res) => {
  try {
    const sql = `
      SELECT
        c.relname AS table_name,
        obj_description(c.oid) AS comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY comment NULLS LAST, table_name
    `;
    const result = await pool.query(sql);
    // Group tables by comment (roll up)
    const grouped = {};
    for (const row of result.rows) {
      const comment = row.comment || 'No Comment';
      if (!grouped[comment]) grouped[comment] = [];
      grouped[comment].push(row.table_name);
    }
    res.json({ grouped });
  } catch (err) {
    console.error('Object explorer error:', err);
    res.status(400).json({ error: err.message || 'Unknown error', details: err });
  }
});

// AI Chat endpoint: integrates Anthropic Sonnet 3.7, schema embeddings, and docs
app.post('/api/ai-chat', async (req, res) => {
  const { message, editorContents, chatHistory, user_id, agent_id, session_id, tags, context, rating, source, sampledResults } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const chatStartedAt = new Date();
  let aiText = '', chatEndedAt;
  let aiResponse = null;
  let error_message = null;
  // 1. Embed user message using OpenAI
  let userEmbedding;
  try {
    userEmbedding = await embedText(message);
    console.log('[AI-CHAT] User message:', message);
    console.log('[AI-CHAT] User embedding:', userEmbedding.slice(0, 5), '...');
  } catch (e) {
    console.error('[AI-CHAT] Embedding failed:', e);
    return res.status(500).json({ error: 'Embedding failed: ' + (e.message || e) });
  }
  // Convert JS array to Postgres vector string format '[0.1,0.2,...]'
  const pgvector = '[' + userEmbedding.join(',') + ']';

  // 2. Retrieve full schema for context
  let schemaRows = [];
  let formattedSchema = '';
  try {
    // Dynamically fetch schema summary from information_schema
    const schemaResults = await pool.query(`
      SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS columns
      FROM information_schema.columns
      WHERE table_schema = 'public'
      GROUP BY table_name
      ORDER BY table_name;
    `);
    schemaRows = schemaResults.rows;
    formattedSchema = 'table_name\tcolumns\n' +
      schemaRows.map(r => `${r.table_name}\t${r.columns}`).join('\n');
    console.log('[AI-CHAT] Dynamic schema summary generated for system prompt.');
  } catch (e) {
    console.error('[AI-CHAT] Schema fetch failed:', e);
    formattedSchema = '';
  }

  // Use system prompt from file (or fallback), now with editorContents and sampledResults
  const systemPrompt = getSystemPrompt(formattedSchema, editorContents || '', sampledResults || '');
  // Log the final system prompt for debugging
  console.log('[AI-CHAT] FINAL SYSTEM PROMPT:\n', systemPrompt);

  // 5. Call Anthropic API
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        system: systemPrompt,
        messages: chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0
          ? chatHistory
          : [
              { role: 'user', content: [
                { type: 'text', text: message },
                editorContents ? { type: 'text', text: `SQL Editor Contents:\n${editorContents}` } : undefined
              ].filter(Boolean) }
            ]
      }),
    });
    const anthropicData = await anthropicRes.json();
    if (!anthropicRes.ok) throw new Error(anthropicData.error?.message || 'Anthropic API error');
    aiText = anthropicData.content?.[0]?.text || '';
    chatEndedAt = new Date();
    // Try to extract SQL code blocks from the response
    const sqlCodeBlocks = [];
    // Match ```sql ... ``` and also ``` ... ```
    const codeBlockRegex = /```(?:sql)?\s*([\s\S]*?)```/gim;
    let match;
    while ((match = codeBlockRegex.exec(aiText)) !== null) {
      if (match[1]) sqlCodeBlocks.push(match[1].trim());
    }
    // Fallback: also extract any lines that look like SQL if no code blocks found
    if (sqlCodeBlocks.length === 0) {
      const fallbackSql = aiText.match(/((SELECT|INSERT|UPDATE|DELETE|DESCRIBE|SHOW)[^`]+(;|$))/im);
      if (fallbackSql && fallbackSql[1]) sqlCodeBlocks.push(fallbackSql[1].trim());
    }
    // Log extracted SQL code blocks for debugging
    console.log('[AI-CHAT] Extracted SQL code blocks:', sqlCodeBlocks);
    if (sqlCodeBlocks.length > 0) {
      aiResponse = { action: 'insert', code: sqlCodeBlocks.join('\n\n') };
    }
    aiResponse = { response: aiText, ...(aiResponse ? { sql_editor_action: aiResponse } : {}) };
    res.json(aiResponse);
    await logChatHistory({
      started_at: chatStartedAt,
      ended_at: chatEndedAt,
      user_id,
      agent_id,
      session_id,
      prompt: message,
      response: aiText,
      tags,
      context,
      rating,
      source
    });
  } catch (err) {
    chatEndedAt = new Date();
    error_message = err.message || 'AI chat failed';
    res.status(500).json({ error: error_message });
    await logChatHistory({
      started_at: chatStartedAt,
      ended_at: chatEndedAt,
      user_id,
      agent_id,
      session_id,
      prompt: message,
      response: error_message,
      tags,
      context,
      rating,
      source
    });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
