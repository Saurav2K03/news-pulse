# News Pulse

A news aggregator that scrapes RSS feeds, figures out which articles are about the same story, and throws them onto a timeline so you can see what's happening at a glance. The timeline uses an EKG-style heartbeat visual — each "pulse" is an article, and you can tell how active a topic is by how many beats it has.

## Live URLs

- **Frontend:** https://newspulseclusters.vercel.app
- **Backend API:** https://newspulse-api-aq5e.onrender.com (you can hit `/health`, `/clusters`, or `/timeline` directly)

## News sources

I'm pulling from five feeds:

- **BBC News** — `http://feeds.bbci.co.uk/news/rss.xml`
- **NPR** — `https://feeds.npr.org/1001/rss.xml`
- **The Guardian** — `https://www.theguardian.com/world/rss`
- **Al Jazeera** — `https://www.aljazeera.com/xml/rss/all.xml`
- **Reuters** — `https://news.google.com/rss/search?q=site:reuters.com+when:7d`

Worth mentioning: Reuters doesn't have a public RSS feed anymore. I got around this by using a Google News RSS query scoped to `site:reuters.com`, which gives you proper Reuters articles with their timestamps and original links intact.

## How the topic clustering works

I used **keyword overlap with weighted Jaccard similarity**. No ML libraries, no scikit-learn — just plain Python.

Here's what happens step by step:

1. Take each article's headline and summary, lowercase everything, toss out stop words ("the", "and", "is"...) and anything under 3 characters.
2. Count how many articles each remaining word shows up in across the whole batch. Words that appear in fewer articles get higher weights (this is basically IDF). So "ceasefire" is worth way more than "government" when comparing two articles.
3. To check if two articles belong together, I compute a weighted Jaccard score — add up the IDF weights of shared words, divide by the total IDF weights of all words combined. Higher score = more related.
4. I also enforce a minimum of 2 shared keywords. This stops two articles from merging just because they both happen to mention one rare proper noun.
5. Each article gets compared against existing clusters. If the best match scores above the threshold, it joins that cluster. Otherwise it starts a new one.

**Why I picked this over TF-IDF/KMeans:** KMeans makes you decide the number of clusters ahead of time, and when you're dealing with live news that changes hourly, you just can't know that. My approach figures out the number of clusters on its own. Plus, the whole thing is about 130 lines of Python — easy to understand, easy to debug.

**How I picked the thresholds:** Honestly, just trial and error against live feeds. I ran the scraper a bunch of times and eyeballed the results:
- At `SIMILARITY_THRESHOLD = 0.14`, almost every article ended up in its own cluster — too strict.
- At `0.08`, random unrelated stories were getting merged — too loose.
- `0.10` was the sweet spot. Stories about the same event (elections, heatwaves, etc.) grouped together, and unrelated ones stayed separate.
- `MIN_SHARED_KEYWORDS = 2` is just a safety net so two articles can't merge on a single coincidental word.

**One limitation I ran into:** The greedy merging can cause "concept drift." Here's what I mean — say you have a cluster about Gaza. An article joins because it shares words like "ceasefire" and "hostages." Now the cluster also has the word "Iran" from that article. Later, an article about Iran's nuclear program might get pulled in because it shares "Iran" and another word from the cluster, even though it's a totally different story. I could fix this with a pairwise similarity graph, but honestly for a 24-hour window the drift doesn't get bad enough to matter much.

## Architecture

The project has three parts:

```
/scraper  — Python. Pulls RSS feeds, extracts articles, groups them into clusters.
/backend  — Node.js (Express). REST API that serves clusters and timeline data.
/frontend — Next.js. The timeline UI.
```

They all share a SQLite database (`data/newspulse.db`).

### Scraper (`/scraper`)

`ingest.py` does the RSS pulling. The annoying part is that every feed does things slightly differently — BBC uses `<description>`, others use `<content:encoded>`, date fields are sometimes `published`, sometimes `updated`, sometimes missing entirely. The normalizer tries all the variants and doesn't crash if something's weird.

For article bodies, I fetch the actual page with `requests` and use BeautifulSoup to pull out the text. I only do this for the 15 most recent articles per feed so I'm not hammering their servers. If a page fails to parse (paywalls, weird layouts, whatever), it just logs a warning and moves on.

Deduplication works off the article GUID or URL — re-running the scraper won't create duplicates. Articles older than 24 hours get pruned automatically.

`cluster.py` runs the grouping algorithm described above. It rebuilds all clusters from scratch each time — cluster IDs aren't stable between runs, but that's fine since the API always serves whatever's current.

`run_pipeline.py` ties it all together and writes job status to the database so the backend can report progress to the frontend.

### Backend (`/backend`)

Express app with five endpoints:

| Route | What it does |
|---|---|
| `GET /clusters` | List clusters — label, article count, time range, which sources |
| `GET /clusters/:id` | One cluster with all its articles sorted by time. 400 for bad IDs, 404 if not found |
| `GET /timeline` | Same data but shaped for the chart — includes intensity scores and per-article timestamps |
| `POST /ingest/trigger` | Kicks off the Python pipeline in the background, returns a job ID. 409 if one's already running |
| `GET /ingest/status/:jobId` | Poll this to check if the job finished |

Uses Node 22's built-in `node:sqlite` — no native addon compilation, which makes deployment a lot easier. Everything's configured through env vars (`backend/.env.example` has the defaults).

### Frontend (`/frontend`)

The timeline is hand-built SVGs, not a charting library. I tried `recharts` early on but the EKG concept didn't fit any standard chart type. Each cluster gets a full-width waveform where the "heartbeats" land at the exact timestamps of its articles, with flat baselines in between. Bigger clusters get taller spikes.

Other stuff:
- Source filter — toggle outlets on and off
- Click a cluster to see its articles (links to the originals)
- Desktop shows the article list in a sidebar, mobile expands it inline
- "Refresh" button triggers a new scrape and polls until it's done
- Auto-refreshes every 60 seconds on its own

## Deployment

| What | Where | Why |
|---|---|---|
| Frontend | Vercel | It's Next.js, Vercel just works |
| Backend + scraper | Render (Docker) | The API needs to spawn the Python scraper as a subprocess, so they have to be in the same container. Render does Docker on the free tier and gives you a persistent disk |
| Database | SQLite file on Render's disk | Only one thing writes to it (the scraper) and one thing reads it (the API). No point running a whole Postgres instance for that |

To deploy:
1. Push to GitHub
2. On Render: New → Blueprint → pick the repo. `render.yaml` handles provisioning
3. On Vercel: Import repo, root directory = `frontend/`, set `NEXT_PUBLIC_API_URL` to your Render URL
4. On Render: Set `CORS_ORIGIN` to your Vercel URL

No secrets in the code — everything's in env vars on the platforms.

## Running locally

Need Python 3.9+ and Node 22+.

**Scraper:**
```bash
cd scraper
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run_pipeline.py
```

**Backend:**
```bash
cd backend
npm install
cp .env.example .env
npm start                    # localhost:4000
```

**Frontend:**
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev                  # localhost:3000
```

## API quick reference

```bash
curl localhost:4000/clusters
curl localhost:4000/clusters/42
curl localhost:4000/timeline
curl -X POST localhost:4000/ingest/trigger   # → {"jobId":"...","status":"running"}
curl localhost:4000/ingest/status/<jobId>     # → {"status":"completed","detail":"..."}
```
