// server/index.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fetch = require('node-fetch');
const { embedText } = require('./openai');

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

// Query endpoint with row limit
app.post('/api/query', async (req, res) => {
  let { sql, rowLimit } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'SQL required' });
  }
  rowLimit = Math.max(1, Math.min(parseInt(rowLimit || 1000, 10), 100000));
  // Try to append LIMIT if not present (simple heuristic for SELECTs)
  let sqlToRun = sql.trim();
  if (/^select/i.test(sqlToRun) && !/limit\s+\d+$/i.test(sqlToRun)) {
    sqlToRun += ` LIMIT ${rowLimit}`;
  }
  try {
    const result = await pool.query(sqlToRun);
    res.json({ rows: result.rows, fields: result.fields, rowLimit });
  } catch (err) {
    console.error('Query error:', err);
    res.status(400).json({ error: err.message || 'Unknown error', details: err });
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
  const { message, editorContents } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

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
  let schemaContext = '';
  let schemaRows = [];
  try {
    const schemaResults = await pool.query(
      `SELECT table_name, column_name FROM schema_embeddings`
    );
    schemaRows = schemaResults.rows;
    // Only use valid, unique table.column pairs for schema context
    const uniquePairs = Array.from(new Set(schemaRows
      .filter(r => r.table_name)
      .map(r => r.column_name ? `${r.table_name}.${r.column_name}` : r.table_name)
    ));
    schemaContext = uniquePairs.join('\n');
    console.log('[AI-CHAT] Full schema rows:', schemaRows.length);
    console.log('[AI-CHAT] Unique table/column pairs:', uniquePairs.length);
  } catch (e) {
    console.error('[AI-CHAT] Schema fetch failed:', e);
    schemaContext = '';
  }

  // Format schema as table-to-columns map
  const tableToCols = {};
  schemaRows.forEach(r => {
    if (!r.table_name) return;
    if (!tableToCols[r.table_name]) tableToCols[r.table_name] = new Set();
    if (r.column_name) tableToCols[r.table_name].add(r.column_name);
  });
  const formattedSchema = Object.entries(tableToCols)
    .map(([table, cols]) => `${table}: ${(Array.from(cols).join(', ') || '(no columns)')}`)
    .join('\n');

  // Strong, isolated system prompt (no DOCS)
  const systemPrompt = `YOU ARE AN EXPERT AI SQL ASSISTANT.\n\n**IMPORTANT: ONLY answer using the SCHEMA below. DO NOT use any other knowledge, documentation, or system catalogs. DO NOT mention information_schema, pg_tables, or meta-commands. If you do not know the answer from the schema, say so.**\n\nSCHEMA:\n${formattedSchema}`;
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
        messages: [
          { role: 'user', content: [
            { type: 'text', text: message },
            editorContents ? { type: 'text', text: `SQL Editor Contents:\n${editorContents}` } : undefined
          ].filter(Boolean) }
        ]
      })
    });
    const anthropicData = await anthropicRes.json();
    if (!anthropicRes.ok) throw new Error(anthropicData.error?.message || 'Anthropic API error');
    // Try to extract SQL code blocks from the response
    const aiText = anthropicData.content?.[0]?.text || '';
    let sqlEditorAction = null;
    // Improved extraction: extract all ```sql ... ``` code blocks (global, multiline)
    const sqlCodeBlocks = [];
    const codeBlockRegex = /```sql\s*([\s\S]*?)```/gim;
    let match;
    while ((match = codeBlockRegex.exec(aiText)) !== null) {
      if (match[1]) sqlCodeBlocks.push(match[1].trim());
    }
    // Fallback: also extract any lines that look like SQL if no code blocks found
    if (sqlCodeBlocks.length === 0) {
      const fallbackSql = aiText.match(/((SELECT|INSERT|UPDATE|DELETE)[^`]+(;|$))/im);
      if (fallbackSql && fallbackSql[1]) sqlCodeBlocks.push(fallbackSql[1].trim());
    }
    if (sqlCodeBlocks.length > 0) {
      sqlEditorAction = { action: 'insert', code: sqlCodeBlocks.join('\n\n') };
    }
    res.json({ response: aiText, ...(sqlEditorAction ? { sql_editor_action: sqlEditorAction } : {}) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'AI chat failed' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
