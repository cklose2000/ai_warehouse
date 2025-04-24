![AI Warehouse Logo](ai_warehouse_pic2.png)

# AI Warehouse: AI-Powered DBA Web UI

This project is a modern, intuitive web-based UI for database administration and SQL analytics, inspired by Amazon Redshift Query Editor v2, with deep AI chat assistant (LLM) integration.

## April 2025 UI/UX Improvements

- **Image Upload UI**: Image upload is now fully invisible and non-intrusive. You can paste or drag images into the chat input, but there is no preview or visible upload area, maximizing space for chat.
- **Chat Input Area**: The chat input is now visually distinct, with a clear border and background. It stretches to use available space, and the font size is extremely small for maximum density.
- **Font Size Customization**: Chat input and chat window font size have been reduced by 5 points (now ~10px), for a compact, power-user-friendly experience.
- **Focus/Usability Fixes**: The chat input is always clickable and focusable, with no UI elements blocking pointer or keyboard events.

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

## Major April 2025 Updates: Semantic Chat History & Context Injection

- **Semantic (Vector) Search for Chat History:**
  - The backend now generates OpenAI embeddings for each chat message and stores them in the `embedding` column of the `chat_history` table (using pgvector).
  - When the user (or agent) asks to review or summarize past conversations about a topic, the backend automatically retrieves the most relevant chat history using both semantic (vector similarity) and keyword search.
  - The agent is now aware of this capability and will focus on summarizing or analyzing the provided context, rather than writing SQL to search chat history.

- **Automatic Context Injection:**
  - Relevant chat history is injected into the agent's context for every new chat request, enabling the agent to reference and build upon previous conversations for improved continuity and relevance.

- **System Prompt Improvements:**
  - The system prompt now includes clear instructions about backend semantic search, so the agent does not need to write SQL for chat history lookups.
  - The prompt is fully user-editable at runtime via `system_prompt.txt`.

- **Bug Fixes:**
  - Fixed vector format bug (`Vector contents must start with "["`) by ensuring embeddings are always formatted as Postgres vector literals before insertion.
  - Schema extraction and delivery to the agent is now robust and always includes all tables, including `raw_*` tables.

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
- **System prompt is now user-editable**: The system prompt can be updated at runtime, allowing flexible agent behavior and experimentation.
- **Backend now loads system prompt from file** (2025-04-18): The backend reads the system prompt from `system_prompt.txt` at startup. To update the agent's behavior, simply edit this file and restart the backend server. This enables fast iteration and experimentation with prompt engineering, without code changes or redeploys.

## Recent Features Added (2025-04)
- **AI Chat Assistant**: Integrated Anthropic Sonnet 3.7 LLM via `/api/ai-chat` endpoint. Streams responses in a dedicated right-side panel.
- **Streaming Chat UI**: AI chat panel displays streaming responses, supports multi-line input, and always has access to the SQL editor.
- **Results Copy Button**: One-click copy of results as TSV to clipboard, with Snackbar notification.
- **Dark Mode & Tiny Text**: Full dark mode, extremely small text for all UI elements.
- **Resizable Panes**: All panes (object explorer, editor, results, chat) are slidable/resizable.
- **Object Explorer**: Groups tables by comment, supports refresh, and collapsible groups.
- **Multi-query Support**: Query editor supports multiple queries per submission.
- **History Persistence**: Every executed query and chat is saved to the database for auditing.
- **Security**: API keys secured in `.env`, backend never exposes secrets to frontend, user input validated.
- **Agent SQL Insertion Markup** (2025-04-18): All agent-generated SQL is now inserted into the editor with two blank lines above and below, and clear header/footer comments (`-- BEGIN AGENT GENERATED SQL --`, `-- END AGENT GENERATED SQL --`). This ensures visually distinct, clearly marked SQL blocks regardless of how the agent returns code.
- **Dynamic Schema and Query Context Injection** (2025-04-19): Backend system prompt now supports `{EDITOR_CONTENTS}` and `{SAMPLED_RESULTS}` placeholders, dynamically injecting the current query editor contents and up to 3 sampled results into the agent's context for every chat request. Frontend always sends these with each chat message, so the agent is aware of user context without manual copy-paste.
- **System Prompt Editable at Runtime**: The system prompt is fully user-editable via `system_prompt.txt` at project root. Edit and restart backend for rapid prompt engineering.
- **Proposed: Last Run Query Display**: A feature to show the first 50 characters of the most recently run query in tiny font above or below the results grid, to help users keep track of what was just executed (pending user placement approval).

## Current Status (2025-04-20)

- The AI assistant now reliably sees **all database tables**, including all `raw_*` tables, thanks to a dynamic schema injection fix.
- The backend and frontend both deliver the full, up-to-date schema context to the agent and UI, as confirmed by backend logs and system prompt inspection.
- The system prompt template now uses a `{SCHEMA}` placeholder, ensuring the backend injects the live schema block into every agent interaction.
- The frontend and backend schema extraction logic has been reviewed for robustness; extraction is now resilient to formatting changes and includes all tables.
- All previous issues with missing tables in agent responses are resolved. The agent now provides accurate, schema-aware SQL and advice for all tables.
- See `system_prompt.txt` for the editable system prompt and `{SCHEMA}` placeholder usage.

### Next Steps
- (Optional) Add backend interception for schema enumeration/count queries for guaranteed accuracy.
- Continue polish, code cleanup, and user experience improvements as needed.

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

## Backlog Project: dbt Integration Ideas (NeonDB Serverless)

These are potential features and architectural suggestions for incorporating dbt functionality into the UI, with special consideration for NeonDB serverless (no direct file storage):

### 1. "dbt/YAML" Tab in SQL Editor
- Add a dedicated tab for editing dbt model SQL and YAML config files (schema.yml, sources.yml, etc.)
- Syntax highlighting for both SQL and YAML
- Allow switching between SQL and YAML modes
- Save changes to an external storage location (S3, GitHub, etc.)

### 2. dbt Project Explorer Panel
- Sidebar/panel that visualizes dbt project structure (models, sources, macros, snapshots)
- Click to edit any file in the "dbt/YAML" tab
- Show dbt documentation and model lineage in a preview pane

### 3. dbt Run/Compile/Test Integration
- Allow users to trigger dbt commands (run, compile, test) from the UI
- Display logs and results in a dedicated output panel
- Use a backend job runner (CI/CD, Lambda, etc.) to execute dbt with files from S3/GitHub

### 4. dbt Model/SQL Preview and Linting
- Live preview of compiled SQL as users edit models
- YAML and dbt config validation
- Inline error/warning display

### 5. AI-Assisted dbt Authoring
- Use the AI assistant to suggest dbt model SQL or YAML
- Auto-generate schema.yml from table definitions
- Summarize/explain dbt model logic

### 6. Non-Database File Management (Serverless)
- Store dbt project files in S3, GitHub, or similar
- Backend acts as a proxy for editing/saving files
- Optionally cache files in memory or ephemeral storage for editing sessions

### 7. Example Workflow
- User edits a dbt file in the UI, backend pushes to S3/GitHub
- User triggers a dbt run, backend job runner executes and streams logs/results to UI

### Summary Table

| Feature                    | UI/UX Location      | Storage/Execution Strategy          |
|----------------------------|---------------------|-------------------------------------|
| dbt/YAML tab               | SQL editor          | S3, GitHub, or similar             |
| Project explorer           | Sidebar/panel       | S3, GitHub, or similar             |
| Run/compile/test dbt       | Button/panel        | Backend job runner (CI/Lambda)      |
| AI dbt authoring           | Chat panel/editor   | N/A (uses AI, stores in above)      |
| File management            | Explorer/editor     | S3, GitHub, or similar             |

---
