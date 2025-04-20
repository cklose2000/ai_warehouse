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
