import os
print("GOOGLE_APPLICATION_CREDENTIALS:", os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"))
import pandas as pd
import psycopg2
import psycopg2.extras
from google.cloud import bigquery
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# Set GOOGLE_APPLICATION_CREDENTIALS for BigQuery
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')

# NeonDB connection info
POSTGRES_URL = os.getenv('POSTGRES_URL')

# Create BigQuery client
client = bigquery.Client()

def extract_github_data(query, output_filename):
    output_file_path = f'github_data/{output_filename}'
    if os.path.exists(output_file_path):
        print(f"File {output_file_path} already exists. Skipping extraction.")
        return
    print(f"Running query: {query[:100]}...")
    query_job = client.query(query)
    results = query_job.result()
    df = results.to_dataframe()
    os.makedirs('github_data', exist_ok=True)
    if output_filename.endswith('.csv'):
        df.to_csv(output_file_path, index=False)
    else:
        df.to_parquet(output_file_path, index=False)
    print(f"Saved {df.shape[0]} rows to github_data/{output_filename}")
    return df

def infer_pg_types_from_bq_schema(bq_schema):
    bq_to_pg_type = {
        'STRING': 'TEXT',
        'INTEGER': 'BIGINT',
        'FLOAT': 'DOUBLE PRECISION',
        'BOOLEAN': 'BOOLEAN',
        'TIMESTAMP': 'TIMESTAMP',
        'DATE': 'DATE',
        'DATETIME': 'TIMESTAMP',
        'RECORD': 'JSONB',
        'NUMERIC': 'NUMERIC',
        'BIGNUMERIC': 'NUMERIC',
        'BYTES': 'BYTEA',
    }
    return [(field.name, bq_to_pg_type.get(field.field_type, 'TEXT')) for field in bq_schema]

def print_create_table_statement(table_name, schema_cols):
    cols_sql = ',\n  '.join([f'"{name}" {typ}' for name, typ in schema_cols])
    create_sql = f'CREATE TABLE IF NOT EXISTS {table_name} (\n  {cols_sql}\n);'
    print(f"\n[PREVIEW] Proposed CREATE TABLE for '{table_name}':\n{create_sql}\n")

def copy_to_neon(df, table_name, bq_schema=None):
    if bq_schema:
        schema_cols = infer_pg_types_from_bq_schema(bq_schema)
    else:
        schema_cols = [(col, 'TEXT') for col in df.columns]
    print_create_table_statement(table_name, schema_cols)
    conn = psycopg2.connect(POSTGRES_URL)
    cur = conn.cursor()
    cols = ', '.join([f'"{col}" {typ}' for col, typ in schema_cols])
    cur.execute(f'CREATE TABLE IF NOT EXISTS {table_name} ({cols});')
    columns = [col for col, _ in schema_cols]
    # Convert missing values to None for SQL NULL insertion
    values = [tuple(None if pd.isna(v) else v for v in row) for _, row in df.iterrows()]
    col_names = ', '.join([f'"{col}"' for col in columns])
    insert_sql = f'INSERT INTO {table_name} ({col_names}) VALUES %s'
    psycopg2.extras.execute_values(cur, insert_sql, values, page_size=1000)
    conn.commit()
    cur.close()
    conn.close()
    print(f"Copied {df.shape[0]} rows to {table_name}")

# Example queries (fixed to only use valid fields)
actors_query = """
SELECT DISTINCT
  actor.id AS actor_id,
  actor.login AS login,
  actor.url AS url,
  actor.avatar_url AS avatar_url
FROM `githubarchive.month.202301`
LIMIT 500000
"""
actors_job = client.query(actors_query)
actors_df = actors_job.result().to_dataframe()
extract_github_data(actors_query, 'dim_actors.parquet')
copy_to_neon(actors_df, 'dim_actors', actors_job.result().schema)

repos_query = """
SELECT DISTINCT
  repo.id AS repo_id,
  repo.name AS name,
  repo.url AS url
FROM `githubarchive.month.202301`
LIMIT 300000
"""
repos_job = client.query(repos_query)
repos_df = repos_job.result().to_dataframe()
extract_github_data(repos_query, 'dim_repositories.parquet')
copy_to_neon(repos_df, 'dim_repositories', repos_job.result().schema)

event_types_query = """
SELECT DISTINCT
  type AS event_type
FROM `githubarchive.month.202301`
"""
event_types_job = client.query(event_types_query)
event_types_df = event_types_job.result().to_dataframe()
extract_github_data(event_types_query, 'dim_event_types.csv')
copy_to_neon(event_types_df, 'dim_event_types', event_types_job.result().schema)

events_query = """
SELECT
  id AS event_id,
  type AS event_type,
  actor.id AS actor_id,
  repo.id AS repo_id,
  org.id AS org_id,
  created_at,
  JSON_EXTRACT(payload, '$.action') AS action,
  public
FROM `githubarchive.month.202301`
LIMIT 1000000
"""
events_job = client.query(events_query)
events_df = events_job.result().to_dataframe()
extract_github_data(events_query, 'fact_events.parquet')
copy_to_neon(events_df, 'fact_events', events_job.result().schema)
