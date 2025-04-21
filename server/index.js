// server/index.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fetch = require('node-fetch');
const { embedText, chatWithOpenAI } = require('./openai');
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

// Log the connected database user and database name for debugging
const whoami = pool.query('SELECT current_user, current_database()');
whoami.then(result => {
  console.log('[AI-CHAT] Connected as user:', result.rows[0].current_user, 'on database:', result.rows[0].current_database);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Utility: Insert chat history log
async function logChatHistory({ started_at, ended_at, user_id, agent_id, session_id, prompt, response, tags, context, rating, source }) {
  try {
    // Embed the prompt (user message) for semantic search
    const toEmbed = prompt || response;
    let embedding = null;
    if (toEmbed) {
      const arr = await embedText(toEmbed); // returns an array of floats
      embedding = '[' + arr.join(',') + ']'; // format as Postgres vector literal
    }
    await pool.query(
      `INSERT INTO chat_history (started_at, ended_at, user_id, agent_id, session_id, prompt, response, tags, context, rating, source, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [started_at, ended_at, user_id, agent_id, session_id, prompt, response, tags, context, rating, source, embedding]
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

// Helper: Retrieve relevant chat history by embedding similarity
async function getRelevantChatHistory(userId, embedding, limit = 5) {
  try {
    const { rows } = await pool.query(
      'SELECT prompt AS message, response, created_at FROM chat_history WHERE user_id = $1 AND embedding IS NOT NULL ORDER BY embedding <#> $2::vector LIMIT $3',
      [userId, embedding, limit]
    );
    return rows.map(r => ({
      role: 'user', // You may enhance this if you track agent/user in the future
      content: `[${r.created_at.toISOString()}] ${r.message}`
    }));
  } catch (e) {
    console.error('[AI-CHAT] Failed to fetch relevant chat history:', e);
    return [];
  }
}

// Query endpoint (no backend-enforced LIMIT)
app.post('/api/query', async (req, res) => {
  let { sql, rowLimit, user_id, session_id, tags } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'SQL required' });
  }
  let sqlToRun = sql.trim();
  // No longer append LIMIT automatically
  const start = Date.now();
  let status = 'success', error_message = null, result_sample = null;
  try {
    const result = await pool.query(sqlToRun);
    res.json({
      rows: result.rows,
      fields: result.fields,
      rowLimit,
      limitInSql: undefined,
    });
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

// AI Chat endpoint: integrates OpenAI, schema embeddings, and docs
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

  // 2. Retrieve relevant chat history using embedding similarity
  let relevantHistory = [];
  try {
    relevantHistory = await getRelevantChatHistory(user_id, pgvector, 5);
    console.log('[AI-CHAT] Relevant chat history:', relevantHistory);
  } catch (e) {
    console.error('[AI-CHAT] Failed to retrieve relevant chat history:', e);
  }

  // 3. Retrieve full schema for context
  let schemaRows = [];
  let formattedSchema = '';
  try {
    // Dynamically fetch schema summary from all user schemas (not just public), including types and comments
    const schemaResults = await pool.query(`
      SELECT
        c.table_schema,
        c.table_name,
        string_agg(c.column_name || ' ' || c.data_type, ', ' ORDER BY c.ordinal_position) AS columns,
        obj_description(('"' || c.table_schema || '"."' || c.table_name || '"')::regclass, 'pg_class') AS table_comment
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
      GROUP BY c.table_schema, c.table_name
      ORDER BY c.table_schema, c.table_name;
    `);
    console.log('[AI-CHAT] RAW schemaResults.rows:', JSON.stringify(schemaResults.rows, null, 2));
    console.log('[AI-CHAT] First 5 schemaResults.rows:', JSON.stringify(schemaResults.rows.slice(0, 5), null, 2));
    console.log('[AI-CHAT] schemaResults.rows length:', schemaResults.rows.length);
    console.log('[AI-CHAT] All table names:', schemaResults.rows.map(r => r.table_name));
    schemaRows = schemaResults.rows;
    console.log('[AI-CHAT] SCHEMA ROWS:', JSON.stringify(schemaRows.map(r => r.table_name), null, 2));
    // Log raw schema rows for debugging
    console.log('[AI-CHAT] SCHEMA ROWS:', JSON.stringify(schemaRows, null, 2));
    // Format as schema.table_name\tcolumns\tcomment
    formattedSchema = 'schema.table_name\tcolumns\ttable_comment\n' +
      schemaRows.map(r => `${r.table_schema}.${r.table_name}\t${r.columns}\t${r.table_comment || ''}`).join('\n');
    // Log formatted schema for debugging
    console.log('[AI-CHAT] FORMATTED SCHEMA FOR PROMPT:\n', formattedSchema);
    console.log('[AI-CHAT] Dynamic schema summary generated for system prompt.');
  } catch (e) {
    console.error('[AI-CHAT] Schema fetch failed:', e);
    formattedSchema = '';
  }

  // Use system prompt from file (or fallback), now with editorContents and sampledResults
  const systemPrompt = getSystemPrompt(formattedSchema, editorContents || '', sampledResults || '');
  // Log the full system prompt sent to the agent for debugging and transparency
  console.log('[AI-CHAT] FULL SYSTEM PROMPT SENT TO AGENT:\n', systemPrompt);

  // 5. Call OpenAI API
  try {
    // Inject relevant history into chatHistory context
    const chatHistoryWithContext = [...relevantHistory, ...(chatHistory || [])];
    aiText = await chatWithOpenAI(systemPrompt, message, chatHistoryWithContext, editorContents, sampledResults);
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
    aiResponse = { response: aiText, ...(aiResponse ? { sql_editor_action: aiResponse } : {}), systemPrompt };
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
