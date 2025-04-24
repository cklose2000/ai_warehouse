"""
Test script for GitHub extraction functions and loading to Postgres.
"""
import os
from github_etl.extract import extract_repos, extract_commits, extract_issues, extract_pull_requests, extract_events, extract_stargazers, extract_contributors
from github_etl.load import load_raw_to_postgres

def test_extract_and_load_all():
    # Use a real public repo for test
    owner = "octocat"
    repo = "Hello-World"
    print("Testing extract_repos...")
    repos = extract_repos(owner, is_org=False)
    print(f"Repos: {len(repos)}")
    load_raw_to_postgres("raw_repos", repos)

    print("Testing extract_commits...")
    commits = extract_commits(owner, repo)
    print(f"Commits: {len(commits)}")
    load_raw_to_postgres("raw_commits", commits)

    print("Testing extract_issues...")
    issues = extract_issues(owner, repo)
    print(f"Issues: {len(issues)}")
    load_raw_to_postgres("raw_issues", issues)

    print("Testing extract_pull_requests...")
    prs = extract_pull_requests(owner, repo)
    print(f"PRs: {len(prs)}")
    load_raw_to_postgres("raw_pull_requests", prs)

    print("Testing extract_events...")
    events = extract_events(owner, repo)
    print(f"Events: {len(events)}")
    load_raw_to_postgres("raw_events", events)

    print("Testing extract_stargazers...")
    stargazers = extract_stargazers(owner, repo)
    print(f"Stargazers: {len(stargazers)}")
    load_raw_to_postgres("raw_stargazers", stargazers)

    print("Testing extract_contributors...")
    contributors = extract_contributors(owner, repo)
    print(f"Contributors: {len(contributors)}")
    load_raw_to_postgres("raw_contributors", contributors)

if __name__ == "__main__":
    test_extract_and_load_all()
