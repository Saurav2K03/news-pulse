"""RSS ingestion: pull articles from multiple feeds, normalize, extract full text, dedupe."""
import logging
from datetime import datetime, timezone

import feedparser
import requests
from bs4 import BeautifulSoup
from dateutil import parser as dateparser

from db import get_conn

log = logging.getLogger("ingest")

FEEDS = [
    {"name": "BBC News", "url": "http://feeds.bbci.co.uk/news/rss.xml"},
    {"name": "NPR", "url": "https://feeds.npr.org/1001/rss.xml"},
    {"name": "The Guardian", "url": "https://www.theguardian.com/world/rss"},
    {"name": "Reuters", "url": "https://news.google.com/rss/search?q=site:reuters.com+when:7d&hl=en-US&gl=US&ceid=US:en"},
    {"name": "Al Jazeera", "url": "https://www.aljazeera.com/xml/rss/all.xml"},
]

HEADERS = {"User-Agent": "Mozilla/5.0 (NewsPulse scraper)"}
REQUEST_TIMEOUT = 10
MAX_BODY_FETCH_PER_FEED = 15  # be polite; only fetch full text for newest N per feed


def _clean_html(html_text):
    """Strip HTML tags from an RSS summary/description snippet."""
    if not html_text:
        return ""
    return BeautifulSoup(html_text, "html.parser").get_text(" ", strip=True)


def _normalize_date(entry):
    """Handle missing pubDate and inconsistent formats; return ISO-8601 UTC string."""
    for key in ("published", "updated", "created"):
        raw = entry.get(key)
        if raw:
            try:
                dt = dateparser.parse(raw)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc).isoformat()
            except (ValueError, OverflowError):
                continue
    # fall back to "now" if the feed omitted the date entirely
    return datetime.now(timezone.utc).isoformat()


def _extract_summary(entry):
    """Different feeds use <description>, <summary>, or <content:encoded>."""
    if entry.get("content"):
        try:
            return _clean_html(entry.content[0].value)
        except (AttributeError, IndexError):
            pass
    return _clean_html(entry.get("summary") or entry.get("description") or "")


def fetch_article_body(url):
    """Fetch the article page and pull out main body text with BeautifulSoup.

    Returns None on any failure — one bad page must not crash the run.
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "header", "footer", "aside", "figure"]):
            tag.decompose()
        container = soup.find("article") or soup.find("main") or soup.body
        if container is None:
            return None
        paragraphs = [p.get_text(" ", strip=True) for p in container.find_all("p")]
        paragraphs = [p for p in paragraphs if len(p) > 40]  # drop boilerplate/captions
        body = "\n\n".join(paragraphs)
        return body if len(body) > 200 else None
    except Exception as exc:  # noqa: BLE001 - graceful degradation by design
        log.warning("body extraction failed for %s: %s", url, exc)
        return None


def normalize_entry(entry, source_name):
    """Normalize a feedparser entry into our internal article schema."""
    link = entry.get("link", "")
    guid = entry.get("id") or link
    title = _clean_html(entry.get("title", "")).strip()
    if not guid or not title:
        return None
    return {
        "guid": guid,
        "title": title,
        "link": link,
        "source": source_name,
        "summary": _extract_summary(entry),
        "published_at": _normalize_date(entry),
    }


def run_ingest(fetch_bodies=True):
    """Pull all feeds; insert only new articles (re-runnable). Returns count of new rows."""
    conn = get_conn()
    new_count = 0
    for feed in FEEDS:
        try:
            parsed = feedparser.parse(feed["url"], request_headers=HEADERS)
        except Exception as exc:  # noqa: BLE001
            log.error("failed to parse feed %s: %s", feed["url"], exc)
            continue
        if not parsed.entries:
            log.warning("no entries from %s", feed["url"])
            continue

        fetched_bodies = 0
        for entry in parsed.entries:
            article = normalize_entry(entry, feed["name"])
            if article is None:
                continue
            exists = conn.execute(
                "SELECT 1 FROM articles WHERE guid = ?", (article["guid"],)
            ).fetchone()
            if exists:
                continue  # already stored on a previous run

            body = None
            if fetch_bodies and article["link"] and fetched_bodies < MAX_BODY_FETCH_PER_FEED:
                body = fetch_article_body(article["link"])
                fetched_bodies += 1

            conn.execute(
                """INSERT OR IGNORE INTO articles
                   (guid, title, link, source, summary, body, published_at, fetched_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    article["guid"], article["title"], article["link"], article["source"],
                    article["summary"], body, article["published_at"],
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            new_count += 1
        conn.commit()
        log.info("feed %s done", feed["name"])

    # Prune articles older than 24 hours.
    # published_at is stored as ISO-8601 with timezone (e.g. 2026-07-03T18:00:00+00:00),
    # so we must compare against the same format — SQLite's datetime() uses a different
    # format and the string comparison silently fails.
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    deleted = conn.execute(
        "DELETE FROM articles WHERE published_at < ?", (cutoff,)
    ).rowcount
    if deleted:
        log.info("pruned %d articles older than 24 h", deleted)
    conn.commit()
    conn.close()
    return new_count
