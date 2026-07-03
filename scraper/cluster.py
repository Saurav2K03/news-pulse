"""Topic grouping (keyword-overlap with TF-weighted Jaccard similarity).

Approach:
  1. Tokenize headline + summary, lowercase, strip stop words and short tokens.
  2. Score similarity between two articles as weighted keyword overlap
     (rarer words count more, using document frequency over the current corpus).
  3. Greedy agglomerative grouping: an article joins an existing cluster if its
     similarity with the cluster centroid keywords crosses a threshold,
     otherwise it starts a new cluster.
  4. Label each cluster with its most common shared keywords.

Clustering is re-run over the whole corpus on every pipeline run so clusters
stay coherent as new articles arrive (clusters table is rebuilt).
"""
import logging
import re
from collections import Counter
from datetime import datetime, timezone

from db import get_conn

log = logging.getLogger("cluster")

# Minimal English stop-word list (standard public list, trimmed)
STOP_WORDS = set("""
a about above after again against all am an and any are as at be because been
before being below between both but by can did do does doing down during each
few for from further had has have having he her here hers herself him himself
his how i if in into is it its itself just me more most my myself no nor not
now of off on once only or other our ours ourselves out over own same she
should so some such than that the their theirs them themselves then there
these they this those through to too under until up very was we were what when
where which while who whom why will with you your yours yourself yourselves
says said say new us also amid after could would may might one two three first
last make makes take takes get gets like still back over years year day days
week weeks month months man woman people
""".split())

TOKEN_RE = re.compile(r"[a-z][a-z\-']{2,}")

SIMILARITY_THRESHOLD = 0.10  # tuned by hand on live feeds; see README
MIN_SHARED_KEYWORDS = 2      # hard floor: at least 2 meaningful words in common


def tokenize(text):
    """Extract meaningful keyword set from text."""
    words = TOKEN_RE.findall(text.lower())
    return {w.strip("-'") for w in words if w not in STOP_WORDS and len(w) > 2}


def _similarity(keywords_a, keywords_b, idf):
    """Weighted Jaccard: shared rare words matter more than shared common ones."""
    shared = keywords_a & keywords_b
    if len(shared) < MIN_SHARED_KEYWORDS:
        return 0.0
    union = keywords_a | keywords_b
    num = sum(idf.get(w, 1.0) for w in shared)
    den = sum(idf.get(w, 1.0) for w in union)
    return num / den if den else 0.0


def _label_for(cluster_articles, idf):
    """Label = most distinctive shared keywords, else representative headline."""
    counts = Counter()
    for art in cluster_articles:
        counts.update(art["keywords"])
    shared = [w for w, c in counts.items() if c >= 2]
    if len(cluster_articles) == 1 or not shared:
        return cluster_articles[0]["title"][:80]
    # rank shared words: appear in most articles first, then rarest in corpus
    shared.sort(key=lambda w: (-counts[w], -idf.get(w, 0.0)))
    return " · ".join(w.capitalize() for w in shared[:3])


def run_clustering():
    """Rebuild clusters over all stored articles. Returns number of clusters."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, title, summary, published_at FROM articles ORDER BY published_at DESC"
    ).fetchall()
    articles = []
    for r in rows:
        articles.append({
            "id": r["id"],
            "title": r["title"],
            "keywords": tokenize(r["title"] + " " + (r["summary"] or "")[:400]),
        })

    # document frequency -> simple idf weights
    df = Counter()
    for art in articles:
        df.update(art["keywords"])
    n_docs = max(len(articles), 1)
    idf = {w: 1.0 + (n_docs / (1 + c)) ** 0.5 for w, c in df.items()}

    clusters = []  # each: {"articles": [...], "keywords": set()}
    for art in articles:
        best, best_score = None, 0.0
        for cl in clusters:
            score = _similarity(art["keywords"], cl["keywords"], idf)
            if score > best_score:
                best, best_score = cl, score
        if best is not None and best_score >= SIMILARITY_THRESHOLD:
            best["articles"].append(art)
            best["keywords"] |= art["keywords"]
        else:
            clusters.append({"articles": [art], "keywords": set(art["keywords"])})

    # persist: rebuild clusters table and re-link articles
    now = datetime.now(timezone.utc).isoformat()
    conn.execute("DELETE FROM clusters")
    for cl in clusters:
        label = _label_for(cl["articles"], idf)
        cur = conn.execute(
            "INSERT INTO clusters (label, created_at) VALUES (?, ?)", (label, now)
        )
        cluster_id = cur.lastrowid
        conn.executemany(
            "UPDATE articles SET cluster_id = ? WHERE id = ?",
            [(cluster_id, a["id"]) for a in cl["articles"]],
        )
    conn.commit()
    conn.close()
    log.info("built %d clusters from %d articles", len(clusters), len(articles))
    return len(clusters)
