import os
import openai
import psycopg2
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
POSTGRES_URL = os.getenv("POSTGRES_URL")

client = openai.OpenAI(api_key=OPENAI_API_KEY)

# Utility: Get all tables and columns from NeonDB
SCHEMA_SQL = """
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
"""

# Utility: Generate embedding for a string using OpenAI API

def get_embedding(text):
    response = client.embeddings.create(
        input=text,
        model="text-embedding-ada-002"
    )
    return response.data[0].embedding

# Main logic

def main():
    conn = psycopg2.connect(POSTGRES_URL)
    cur = conn.cursor()
    cur.execute(SCHEMA_SQL)
    schema_rows = cur.fetchall()
    # Build a list of unique table schemas as text
    table_schemas = {}
    for table, column, dtype in schema_rows:
        table_schemas.setdefault(table, []).append(f"{column} {dtype}")
    # Prepare for embeddings
    embedding_rows = []
    for table, columns in table_schemas.items():
        schema_text = f"Table: {table}\n" + "\n".join(columns)
        embedding = get_embedding(schema_text)
        embedding_rows.append((table, schema_text, embedding))
    # Upsert into schema_embeddings table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS schema_embeddings (
            table_name TEXT PRIMARY KEY,
            schema_text TEXT,
            embedding VECTOR
        );
    """)
    for table, schema_text, embedding in embedding_rows:
        cur.execute(
            """
            INSERT INTO schema_embeddings (table_name, schema_text, embedding)
            VALUES (%s, %s, %s)
            ON CONFLICT (table_name) DO UPDATE SET schema_text = EXCLUDED.schema_text, embedding = EXCLUDED.embedding;
            """,
            (table, schema_text, embedding)
        )
    conn.commit()
    cur.close()
    conn.close()
    print(f"Refreshed embeddings for {len(embedding_rows)} tables.")

if __name__ == "__main__":
    main()
