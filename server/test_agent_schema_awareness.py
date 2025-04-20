"""
Automated test script for agent schema awareness.
This script:
- Sends a crafted system prompt (with a known schema block) to the agent endpoint
- Asks the agent to enumerate all tables it can see
- Compares the agent's response to the expected table list
- Prints a pass/fail result and any discrepancies

Requires: requests, dotenv (for loading .env if needed)
"""
import os
import requests
from typing import List

# Optionally load environment variables from .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# CONFIGURATION
BACKEND_CHAT_URL = os.environ.get("AGENT_CHAT_URL") or "http://localhost:5000/api/ai-chat"

# Example schema block (simulate what backend sends)
SCHEMA_BLOCK = """
schema.table_name\tcolumns\ttable_comment
public.address1\tid integer, name text\tAddress table
public.raw_commits\tid integer, raw jsonb, loaded_at timestamp\tRaw git commits
public.raw_issues\tid integer, raw jsonb, loaded_at timestamp\tRaw issues
public.chat_history\tid integer, message text\tChat logs
public.user_sessions\tid integer, session_token text\tUser sessions
"""
EXPECTED_TABLES = [
    "address1",
    "raw_commits",
    "raw_issues",
    "chat_history",
    "user_sessions"
]

PROMPT_TEMPLATE = f"""
You are a SQL assistant. Use ONLY the schema context below to answer questions.
Schema:
{SCHEMA_BLOCK}

List all tables you can see in the schema context above. Give only the table names as a comma-separated list.
"""

def test_agent_schema_awareness():
    payload = {
        "systemPrompt": PROMPT_TEMPLATE,
        "message": "List all tables you can see in the schema context above. Give only the table names as a comma-separated list."
    }
    try:
        resp = requests.post(BACKEND_CHAT_URL, json=payload, timeout=30)
        print(f"Raw response text: {resp.text}")  # NEW: Print raw backend response
        resp.raise_for_status()
        data = resp.json()
        agent_reply = data.get("response") or data.get("text") or ""
        # Print the full agent reply in chunks to avoid terminal truncation
        print("Full agent reply (chunked):")
        chunk_size = 200
        for i in range(0, len(agent_reply), chunk_size):
            print(agent_reply[i:i+chunk_size])
        # Extract table names from agent reply
        table_names = [t.strip() for t in agent_reply.split(",") if t.strip()]
        print(f"Agent listed tables: {table_names}")
        missing = [t for t in EXPECTED_TABLES if t not in table_names]
        extra = [t for t in table_names if t not in EXPECTED_TABLES]
        if not missing and not extra:
            print("PASS: Agent correctly listed all tables.")
        else:
            print("FAIL:")
            if missing:
                print(f"  Missing tables: {missing}")
            if extra:
                print(f"  Unexpected tables: {extra}")
    except Exception as e:
        print("ERROR during agent test:")
        import traceback
        traceback.print_exc()
        print(f"  Backend URL: {BACKEND_CHAT_URL}")
        print(f"  Payload: {payload}")

if __name__ == "__main__":
    test_agent_schema_awareness()
