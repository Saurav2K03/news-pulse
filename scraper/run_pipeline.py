"""News Pulse pipeline entry point: ingest feeds, then rebuild topic clusters.

Usage:
    python run_pipeline.py [--job-id JOB_ID] [--no-bodies]

--job-id is used by the Node backend to track ingest jobs (jobs table).
"""
import argparse
import logging
import sys
from datetime import datetime, timezone

from db import get_conn
from ingest import run_ingest
from cluster import run_clustering

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("pipeline")


def _set_job(job_id, status, detail=None):
    if not job_id:
        return
    conn = get_conn()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO jobs (id, status, started_at, finished_at, detail)
           VALUES (?, ?, ?, NULL, ?)
           ON CONFLICT(id) DO UPDATE SET
             status = excluded.status,
             detail = excluded.detail,
             finished_at = CASE WHEN excluded.status IN ('completed','failed')
                                THEN ? ELSE finished_at END""",
        (job_id, status, now, detail, now),
    )
    conn.commit()
    conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job-id", default=None)
    ap.add_argument("--no-bodies", action="store_true", help="skip full-text fetching (faster)")
    args = ap.parse_args()

    _set_job(args.job_id, "running")
    try:
        new_articles = run_ingest(fetch_bodies=not args.no_bodies)
        n_clusters = run_clustering()
        detail = f"{new_articles} new articles, {n_clusters} clusters"
        _set_job(args.job_id, "completed", detail)
        log.info("pipeline done: %s", detail)
    except Exception as exc:  # noqa: BLE001
        _set_job(args.job_id, "failed", str(exc))
        log.exception("pipeline failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
