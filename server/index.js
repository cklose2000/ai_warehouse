// server/index.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const fetch = require('node-fetch');

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

  // 1. Retrieve top schema embeddings (e.g., top 3 by similarity)
  let schemaContext = '';
  try {
    const schemaResults = await pool.query(
      `SELECT table_name, column_name, description FROM schema_embeddings ORDER BY embedding <#> (SELECT embedding FROM schema_embeddings ORDER BY embedding <#> (SELECT embedding FROM schema_embeddings WHERE description IS NOT NULL LIMIT 1) LIMIT 1) LIMIT 3`
    );
    schemaContext = schemaResults.rows.map(r => `${r.table_name}.${r.column_name}: ${r.description}`).join('\n');
  } catch (e) { schemaContext = ''; }

  // 2. Retrieve top md_chunks (docs) by similarity (dummy logic, replace with real vector search)
  let docContext = '';
  try {
    const docResults = await pool.query(
      `SELECT chunk FROM md_chunks ORDER BY embedding <#> (SELECT embedding FROM md_chunks LIMIT 1) LIMIT 3`
    );
    docContext = docResults.rows.map(r => r.chunk).join('\n');
  } catch (e) { docContext = ''; }

  // 3. Compose system prompt
  const systemPrompt = `You are an expert AI SQL assistant. Use the following schema and documentation context to help the user.\n\nSCHEMA:\n${schemaContext}\n\nDOCS:\n${docContext}\n\nThe user may also provide SQL code. Be concise, accurate, and helpful.`;

  // 4. Call Anthropic API
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
    res.json({ response: anthropicData.content?.[0]?.text || '' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'AI chat failed' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
