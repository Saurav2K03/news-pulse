// News Pulse backend API
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4000);
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const PIPELINE_SCRIPT =
  process.env.PIPELINE_SCRIPT ||
  path.resolve(__dirname, '../../scraper/run_pipeline.py');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// In-memory job registry, backed by the jobs table written by the Python side.
const jobs = new Map();

app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /clusters — label, article count, source list, time range
app.get('/clusters', (_req, res, next) => {
  try {
    const rows = getDb()
      .prepare(
        `SELECT c.id, c.label,
                COUNT(a.id)        AS articleCount,
                MIN(a.published_at) AS startTime,
                MAX(a.published_at) AS endTime,
                GROUP_CONCAT(DISTINCT a.source) AS sources
         FROM clusters c
         JOIN articles a ON a.cluster_id = c.id
         GROUP BY c.id
         ORDER BY articleCount DESC, endTime DESC`
      )
      .all();
    res.json(
      rows.map((r) => ({ ...r, sources: r.sources ? r.sources.split(',') : [] }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /clusters/:id — full detail, articles sorted chronologically
app.get('/clusters/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Cluster id must be a positive integer' });
    }
    const cluster = getDb()
      .prepare('SELECT id, label, created_at AS createdAt FROM clusters WHERE id = ?')
      .get(id);
    if (!cluster) {
      return res.status(404).json({ error: `Cluster ${id} not found` });
    }
    const articles = getDb()
      .prepare(
        `SELECT id, title, link, source, summary, published_at AS publishedAt
         FROM articles WHERE cluster_id = ? ORDER BY published_at ASC`
      )
      .all(id);
    res.json({ ...cluster, articleCount: articles.length, articles });
  } catch (err) {
    next(err);
  }
});

// GET /timeline — chart-ready: label, start/end, count, intensity 0..1, article times
app.get('/timeline', (_req, res, next) => {
  try {
    const rows = getDb()
      .prepare(
        `SELECT c.id, c.label,
                COUNT(a.id)        AS articleCount,
                MIN(a.published_at) AS startTime,
                MAX(a.published_at) AS endTime,
                GROUP_CONCAT(DISTINCT a.source) AS sources
         FROM clusters c
         JOIN articles a ON a.cluster_id = c.id
         GROUP BY c.id
         ORDER BY startTime ASC`
      )
      .all();
    // Collect individual article timestamps per cluster for EKG positioning
    const articleTimesRows = getDb()
      .prepare(
        `SELECT cluster_id, published_at FROM articles ORDER BY published_at ASC`
      )
      .all();
    const articleTimesMap = new Map();
    for (const r of articleTimesRows) {
      if (!articleTimesMap.has(r.cluster_id)) articleTimesMap.set(r.cluster_id, []);
      articleTimesMap.get(r.cluster_id).push(r.published_at);
    }
    const maxCount = rows.reduce((m, r) => Math.max(m, r.articleCount), 1);
    res.json({
      generatedAt: new Date().toISOString(),
      clusters: rows.map((r) => ({
        id: r.id,
        label: r.label,
        startTime: r.startTime,
        endTime: r.endTime,
        articleCount: r.articleCount,
        intensity: r.articleCount / maxCount,
        sources: r.sources ? r.sources.split(',') : [],
        articleTimes: articleTimesMap.get(r.id) || [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /ingest/trigger — spawn the Python pipeline, return a job id
app.post('/ingest/trigger', (_req, res) => {
  const running = [...jobs.values()].find((j) => j.status === 'running');
  if (running) {
    return res.status(409).json({ error: 'An ingest job is already running', jobId: running.id });
  }
  const jobId = randomUUID();
  const job = { id: jobId, status: 'running', startedAt: new Date().toISOString(), detail: null };
  jobs.set(jobId, job);

  const child = spawn(PYTHON_BIN, [PIPELINE_SCRIPT, '--job-id', jobId], {
    cwd: path.dirname(PIPELINE_SCRIPT),
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.on('error', (err) => {
    job.status = 'failed';
    job.detail = `Failed to start pipeline: ${err.message}`;
    job.finishedAt = new Date().toISOString();
  });
  child.on('exit', (code) => {
    job.finishedAt = new Date().toISOString();
    if (code === 0) {
      job.status = 'completed';
      try {
        const row = getDb().prepare('SELECT detail FROM jobs WHERE id = ?').get(jobId);
        job.detail = row?.detail ?? null;
      } catch {
        /* detail is best-effort */
      }
    } else {
      job.status = 'failed';
      job.detail = job.detail || `Pipeline exited with code ${code}`;
    }
  });

  res.status(202).json({ jobId, status: job.status });
});

// GET /ingest/status/:jobId
app.get('/ingest/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: `Job ${jobId} not found` });
  }
  res.json(job);
});

// 404 + error handling
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`News Pulse API listening on port ${PORT}`);
});
