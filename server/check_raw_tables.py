import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

conn_str = os.getenv('POSTGRES_URL')

if not conn_str:
    raise Exception('POSTGRES_URL not set in .env')

conn = psycopg2.connect(conn_str)
cur = conn.cursor()

# Print connection string, current user, database, and search_path
print('Connection string:', conn_str)
cur.execute('SELECT current_user, current_database()')
print('Connected as:', cur.fetchone())
cur.execute('SHOW search_path')
print('search_path:', cur.fetchone()[0])

print('--- Table Type Check ---')
cur.execute("""
SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_name LIKE 'raw_%'
ORDER BY table_schema, table_name;
""")
for row in cur.fetchall():
    print(row)

print('\n--- Table Owner Check ---')
cur.execute("""
SELECT schemaname, tablename, tableowner
FROM pg_tables
WHERE tablename LIKE 'raw_%'
ORDER BY schemaname, tablename;
""")
for row in cur.fetchall():
    print(row)

print('\n--- Table Grants Check ---')
cur.execute("""
SELECT grantee, privilege_type, table_schema, table_name
FROM information_schema.role_table_grants
WHERE table_name LIKE 'raw_%'
ORDER BY table_schema, table_name;
""")
for row in cur.fetchall():
    print(row)

print('\n--- Backend Schema Query Check ---')
cur.execute("""
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
""")
for row in cur.fetchall():
    print(row)

cur.close()
conn.close()
