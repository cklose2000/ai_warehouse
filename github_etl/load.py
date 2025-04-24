"""
Module: load.py
Handles loading of raw GitHub data into the data warehouse (e.g., Postgres).
"""

import os
import psycopg2
import psycopg2.extras
import json
from typing import List, Dict, Any
from dotenv import load_dotenv

# Load environment variables from .env in project root
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

POSTGRES_URL = os.getenv("POSTGRES_URL")

def get_pg_conn():
    if not POSTGRES_URL:
        raise RuntimeError("POSTGRES_URL not found in environment.")
    return psycopg2.connect(POSTGRES_URL)


def load_raw_to_postgres(table: str, data: List[Dict[str, Any]]):
    """
    Load raw JSON data into a Postgres table as a JSONB column.
    Table will be auto-created if not exists, with columns: id (serial), raw jsonb, loaded_at timestamp.
    """
    if not data:
        print(f"No data to load for {table}.")
        return
    create_sql = f'''
    CREATE TABLE IF NOT EXISTS {table} (
        id SERIAL PRIMARY KEY,
        raw JSONB NOT NULL,
        loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )'''
    insert_sql = f"INSERT INTO {table} (raw) VALUES (%s)"
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(create_sql)
            psycopg2.extras.execute_batch(cur, insert_sql, [(json.dumps(row),) for row in data])
        conn.commit()
    print(f"Loaded {len(data)} records into {table}.")

def load_repos_to_postgres(repos: List[Dict[str, Any]]):
    """Load transformed repo data into Postgres."""
    # TODO: Implement loading logic
    pass
