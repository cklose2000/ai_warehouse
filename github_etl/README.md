# GitHub ETL Pipeline

This package extracts, transforms, and loads GitHub activity data into a warehouse (Postgres by default). Modularized as `extract.py`, `transform.py`, `load.py`.

## Structure
- `extract.py`: GitHub API extraction
- `transform.py`: Data normalization
- `load.py`: Load to warehouse
- `config.yaml`: Config for repos, token, DB
- `etl_runner.py`: Entrypoint script

## Usage
1. Set your `GITHUB_TOKEN` in `.env` or environment.
2. Edit `config.yaml` for repos and DB settings.
3. Install dependencies: `pip install -r requirements.txt`
4. Run: `python etl_runner.py`

## To Do
- Implement full ETL logic per requirements.
- Add tests and logging.
