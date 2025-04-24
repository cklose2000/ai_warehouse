"""
Entrypoint to run the full ETL pipeline.
"""

from extract import extract_repos
from transform import transform_repos
from load import load_repos_to_postgres

if __name__ == "__main__":
    # Example usage: extract, transform, load for repos
    raw_repos = extract_repos("example_org")
    transformed = transform_repos(raw_repos)
    load_repos_to_postgres(transformed)
    print("ETL pipeline completed.")
