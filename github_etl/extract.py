"""
Module: extract.py
Handles extraction of data from GitHub API endpoints.
"""

import os
import requests
from typing import List, Dict, Any, Optional
from urllib.parse import urljoin
from dotenv import load_dotenv

# Load environment variables from .env in project root
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

GITHUB_API_BASE = "https://api.github.com/"


def get_github_token() -> str:
    """Load GitHub token from environment variable."""
    token = os.getenv('GITHUB_PAT')
    if not token:
        raise RuntimeError("GITHUB_PAT not found in environment.")
    return token


def github_api_get(url: str, params: Optional[dict] = None) -> List[dict]:
    """
    Make authenticated GET request to GitHub API, handling pagination and rate limits.
    Returns a list of all items from paginated results.
    """
    headers = {
        'Authorization': f'token {get_github_token()}',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ai-warehouse-etl'
    }
    results = []
    while url:
        resp = requests.get(url, headers=headers, params=params)
        if resp.status_code == 401:
            raise RuntimeError("GitHub authentication failed. Check your GITHUB_PAT.")
        if resp.status_code == 403 and 'X-RateLimit-Remaining' in resp.headers and resp.headers['X-RateLimit-Remaining'] == '0':
            import time
            reset = int(resp.headers.get('X-RateLimit-Reset', 0))
            sleep_time = max(reset - int(time.time()), 1)
            print(f"Rate limit reached. Sleeping for {sleep_time} seconds...")
            time.sleep(sleep_time)
            continue
        resp.raise_for_status()
        page_data = resp.json()
        if isinstance(page_data, dict):
            results.append(page_data)
        else:
            results.extend(page_data)
        # Handle pagination
        link = resp.headers.get('Link', '')
        next_url = None
        if link:
            for part in link.split(','):
                if 'rel="next"' in part:
                    next_url = part[part.find('<')+1:part.find('>')]
                    break
        url = next_url
        params = None  # Only needed for first request
    return results


def extract_repos(username: str, is_org: bool = True) -> List[Dict[str, Any]]:
    """Extract repositories for a given user/org from GitHub API."""
    if is_org:
        endpoint = f"orgs/{username}/repos"
    else:
        endpoint = f"users/{username}/repos"
    url = urljoin(GITHUB_API_BASE, endpoint)
    return github_api_get(url)


def extract_commits(owner: str, repo: str, since: Optional[str] = None) -> List[Dict[str, Any]]:
    """Extract commits for a given repo. Optionally filter by ISO8601 'since' timestamp."""
    endpoint = f"repos/{owner}/{repo}/commits"
    url = urljoin(GITHUB_API_BASE, endpoint)
    params = {'since': since} if since else None
    return github_api_get(url, params=params)


def extract_issues(owner: str, repo: str, state: str = 'all', since: Optional[str] = None) -> List[Dict[str, Any]]:
    """Extract issues for a given repo. State can be 'open', 'closed', or 'all'."""
    endpoint = f"repos/{owner}/{repo}/issues"
    url = urljoin(GITHUB_API_BASE, endpoint)
    params = {'state': state, 'since': since} if since else {'state': state}
    return github_api_get(url, params=params)


def extract_pull_requests(owner: str, repo: str, state: str = 'all') -> List[Dict[str, Any]]:
    """Extract pull requests for a given repo. State can be 'open', 'closed', or 'all'."""
    endpoint = f"repos/{owner}/{repo}/pulls"
    url = urljoin(GITHUB_API_BASE, endpoint)
    params = {'state': state}
    return github_api_get(url, params=params)


def extract_events(owner: str, repo: str) -> List[Dict[str, Any]]:
    """Extract recent events for a given repo (limited to last 300 events by GitHub)."""
    endpoint = f"repos/{owner}/{repo}/events"
    url = urljoin(GITHUB_API_BASE, endpoint)
    return github_api_get(url)


def extract_stargazers(owner: str, repo: str) -> List[Dict[str, Any]]:
    """Extract stargazers for a given repo (returns users who starred the repo)."""
    endpoint = f"repos/{owner}/{repo}/stargazers"
    url = urljoin(GITHUB_API_BASE, endpoint)
    headers = {
        'Authorization': f'token {get_github_token()}',
        'Accept': 'application/vnd.github.v3.star+json',  # For starred_at timestamp
        'User-Agent': 'ai-warehouse-etl'
    }
    results = []
    url_iter = url
    while url_iter:
        resp = requests.get(url_iter, headers=headers)
        resp.raise_for_status()
        page_data = resp.json()
        if isinstance(page_data, dict):
            results.append(page_data)
        else:
            results.extend(page_data)
        link = resp.headers.get('Link', '')
        next_url = None
        if link:
            for part in link.split(','):
                if 'rel="next"' in part:
                    next_url = part[part.find('<')+1:part.find('>')]
                    break
        url_iter = next_url
    return results


def extract_contributors(owner: str, repo: str) -> List[Dict[str, Any]]:
    """Extract contributors for a given repo."""
    endpoint = f"repos/{owner}/{repo}/contributors"
    url = urljoin(GITHUB_API_BASE, endpoint)
    return github_api_get(url)
