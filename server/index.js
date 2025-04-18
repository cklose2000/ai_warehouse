// server/index.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

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

// Query endpoint
app.post('/api/query', async (req, res) => {
  const { sql } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'SQL required' });
  }
  try {
    const result = await pool.query(sql);
    res.json({ rows: result.rows, fields: result.fields });
  } catch (err) {
    console.error('Query error:', err);
    res.status(400).json({ error: err.message || 'Unknown error', details: err });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
