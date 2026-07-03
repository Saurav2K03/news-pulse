"""Database layer for News Pulse scraper (SQLite)."""
import os
import sqlite3

DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "newspulse.db")
DB_PATH = os.environ.get("NEWSPULSE_DB_PATH", os.path.abspath(DEFAULT_DB_PATH))

SCHEMA = """
CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guid TEXT UNIQUE NOT NULL,          -- stable dedupe key (link or feed guid)
    title TEXT NOT NULL,
    link TEXT,
    source TEXT NOT NULL,               -- human-readable outlet name
    summary TEXT,
    body TEXT,                          -- extracted full article text (may be NULL)
    published_at TEXT NOT NULL,         -- ISO-8601 UTC
    fetched_at TEXT NOT NULL,
    cluster_id INTEGER
);

CREATE TABLE IF NOT EXISTS clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,               -- pending | running | completed | failed
    started_at TEXT,
    finished_at TEXT,
    detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_cluster ON articles(cluster_id);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
"""


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn
