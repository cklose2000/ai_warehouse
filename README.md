# AI Warehouse: AI-Powered DBA Web UI

This project is a modern, intuitive web-based UI for database administration and SQL analytics, inspired by Amazon Redshift Query Editor v2, with deep AI chat assistant (LLM) integration.

## What this system does

- Provides a dark-mode, resizable, space-efficient SQL query editor with syntax highlighting and multi-query support.
- Features a database object explorer that groups tables by their comment, never showing schema names.
- Allows users to run multiple queries at once and view results in a dense, copy-friendly results grid.
- Supports an AI chat assistant that can see all query editor content, generate and optimize SQL, and interact with query results.
- Saves all queries to a `query_history` table and all chats to a `chat_history` table for full auditability.
- All panes (object explorer, query editor, results, chat) are slidable and resizable.
- Text is extremely small to maximize screen real estate.
- Built with React + TypeScript (frontend) and Node.js + Express (backend), with Postgres as the database.
- Uses environment variables from `.env` for all API keys and database URLs (see `.env` for details).

## Setup
1. Copy your required API keys and `POSTGRES_URL` into a `.env` file at the project root.
2. Run `npm install` in both `/server` and `/client` directories.
3. Start the backend server from `/server` with `npm run dev`.
4. Start the frontend from `/client` with `npm start`.

## Features
- Dark mode by default
- Slidable/resizable panes
- Multi-query SQL editor
- Results easily copyable to notepad
- Extremely small text
- Query and chat history persistence
- AI assistant always sees full editor content
- Object explorer groups tables by comment

## Project Structure
```
/ai-warehouse/
  /client/      # React frontend
  /server/      # Node.js backend
  .env          # Environment variables (never committed)
  README.md
```

## License
Proprietary, (c) 2025 cklose2000 and contributors.
