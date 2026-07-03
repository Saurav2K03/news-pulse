'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const AUTO_REFRESH_MS = 60_000;

// Wire-service marker colors
const SOURCE_COLORS = {
  'bbc news': '#e81c24',
  npr: '#0052a2',
  'the guardian': '#052962',
  reuters: '#ff8000',
  'al jazeera': '#b5913a',
};
const FALLBACK_COLORS = ['#8a6d3b', '#4a6741', '#5b4a68', '#3b6d8a'];

function sourceColor(name, index = 0) {
  return SOURCE_COLORS[name.toLowerCase()] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

// ---------- helpers ----------



function fmtMetaTime(ts) {
  const d = new Date(ts);
  const time = d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = d.toLocaleString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
  return { time, day };
}

function fmtDateline(ts) {
  const d = new Date(ts);
  const date = d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  }).toUpperCase();
  const time = d.toLocaleString(undefined, {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
  }).toUpperCase();
  return { date, time };
}

function sourceShortName(name) {
  const lower = name.toLowerCase();
  if (lower.includes('bbc')) return 'BBC';
  if (lower.includes('npr')) return 'NPR';
  if (lower.includes('guardian')) return 'Guardian';
  return name;
}

// Turn a raw cluster label into a readable feed topic.
// Keyword labels arrive as "Fresh · Hostilities"; headline labels have no ' · '.
function feedTopic(label) {
  if (!label) return 'Untitled Topic';
  if (label.includes(' · ')) return label.split(' · ').join(' ');
  return label;
}

// ---------- components ----------

/* Top Navigation */
function TopNav({ onRefresh, jobBusy }) {
  return (
    <nav className="bg-background text-primary flex flex-col w-full px-margin-desktop py-4 max-w-full top-0 border-b border-primary/20 z-50 mb-8 sticky">
      <div className="flex justify-between items-center w-full max-w-[1100px] mx-auto">
        <div className="flex items-center gap-6">
          <h1 className="font-headline-display text-headline-display text-primary tracking-tight">News Pulse</h1>
        </div>
        <div className="flex gap-4">
          <button
            className="text-primary hover:text-secondary transition-colors duration-150 cursor-pointer active:opacity-70 disabled:opacity-40"
            onClick={onRefresh}
            disabled={jobBusy}
            title="Refresh the wire"
          >
            <span className="material-symbols-outlined">refresh</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

/* Source Filter */
function SourceFilter({ sources, enabled, onToggle }) {
  return (
    <section className="flex flex-wrap gap-4 border-b border-primary/20 pb-4">
      {sources.map((s, i) => {
        const isOn = enabled.has(s);
        return (
          <button
            key={s}
            className={`flex items-center gap-2 cursor-pointer border-none bg-transparent p-0 transition-opacity duration-150 ${isOn ? 'opacity-100' : 'opacity-30'}`}
            onClick={() => onToggle(s)}
            title={isOn ? `Hide ${s}` : `Show ${s}`}
          >
            <div className="w-3 h-3" style={{ backgroundColor: sourceColor(s, i) }} />
            <span className="font-meta-mono text-meta-mono uppercase">{sourceShortName(s)}</span>
          </button>
        );
      })}
    </section>
  );
}

/* EKG Waveform SVG — full-width trace with beats at article time positions,
   flat baseline where there is no activity. */
function EkgWaveform({ articleTimes, timelineMin, timelineSpan, selected, intensity }) {
  const height = 40;
  const midY = height / 2;
  const svgWidth = 1000; // internal coordinate space, stretches to 100% via viewBox
  const beatHalfWidth = 14; // half-width of each QRS complex in SVG units

  // Map each article timestamp to an x position in [0, svgWidth]
  const beatXs = (articleTimes || []).map((t) => {
    const pct = (+new Date(t) - timelineMin) / timelineSpan;
    return Math.max(beatHalfWidth, Math.min(svgWidth - beatHalfWidth, pct * svgWidth));
  }).sort((a, b) => a - b);

  const points = [`M 0 ${midY}`];

  if (beatXs.length === 0) {
    // No articles → pure flat baseline
    points.push(`L ${svgWidth} ${midY}`);
  } else {
    for (let i = 0; i < beatXs.length; i++) {
      const cx = beatXs[i];
      const bw = beatHalfWidth;

      // Flat line to start of this beat
      points.push(`L ${cx - bw} ${midY}`);
      // P-wave
      points.push(`L ${cx - bw * 0.64} ${midY - 4}`);
      points.push(`L ${cx - bw * 0.36} ${midY}`);
      // Flat before QRS
      points.push(`L ${cx - bw * 0.14} ${midY}`);
      // Q dip
      points.push(`L ${cx - bw * 0.07} ${midY + 4}`);
      // R spike — height varies with intensity
      const spikeH = 12 + intensity * 8;
      points.push(`L ${cx + bw * 0.07} ${midY - spikeH}`);
      // S dip
      points.push(`L ${cx + bw * 0.21} ${midY + 5}`);
      // Return to baseline
      points.push(`L ${cx + bw * 0.36} ${midY}`);
      // T-wave
      points.push(`L ${cx + bw * 0.57} ${midY - 5}`);
      points.push(`L ${cx + bw * 0.79} ${midY}`);
      // Flat tail after beat
      points.push(`L ${cx + bw} ${midY}`);
    }
    // Flat line to end
    points.push(`L ${svgWidth} ${midY}`);
  }

  const color = selected ? '#b52617' : '#000000';
  const opacity = selected ? 0.9 : 0.2 + intensity * 0.15;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${svgWidth} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ overflow: 'visible' }}
    >
      <path
        d={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
      />
    </svg>
  );
}

/* Compute a rolling 24-hour window of 6-hour ticks.
   The window ends at the NEXT 6-hour boundary from now, and starts 24h before that.
   Example at 00:42 → next boundary is 06:00 → ticks: 06:00, 12:00, 18:00, 00:00, 06:00
   Example at 13:00 → next boundary is 18:00 → ticks: 18:00, 00:00, 06:00, 12:00, 18:00 */
function get6HourTicks() {
  const now = new Date();
  // Snap to the start of the current 6-hour block in local time
  const blockHour = Math.floor(now.getHours() / 6) * 6;
  const blockStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), blockHour, 0, 0, 0);
  // End of window = end of current 6-hour block (= next boundary)
  const windowEnd = +blockStart + 6 * 3600_000;
  // Start of window = 24 hours before end
  const windowStart = windowEnd - 24 * 3600_000;
  return [
    windowStart,
    windowStart + 6 * 3600_000,
    windowStart + 12 * 3600_000,
    windowStart + 18 * 3600_000,
    windowEnd,
  ];
}

function fmtFixedTick(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/* Timeline with fixed 6-hour gaps */
function Timeline({ clusters, selectedId, detail, onSelect }) {
  const ticks = useMemo(() => get6HourTicks(), []);
  const [visibleCount, setVisibleCount] = useState(20);
  const min = ticks[0];
  const max = ticks[ticks.length - 1];
  const span = max - min;

  if (clusters.length === 0) {
    return (
      <div className="font-meta-mono text-meta-mono text-on-surface-variant uppercase text-center py-10">
        NO CLUSTERS ON THE WIRE — TRY REFRESHING
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      {/* Axis — fixed 6-hour tick labels */}
      <div className="flex items-end mb-2 h-6 border-b border-primary/20 sticky top-0 bg-background z-10">
        <div className="w-2/5 pr-4" />
        <div className="w-3/5 relative">
          <div className="absolute bottom-1 left-0 right-0 flex justify-between font-meta-mono text-meta-mono text-on-surface-variant">
            {ticks.map((t, i) => (
              <span key={i}>{fmtFixedTick(t)}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Rows — EKG spans the full timeline width, beats at article positions */}
      {clusters.slice(0, visibleCount).map((c) => {
        const selected = c.id === selectedId;
        const showMobileFeed = selected && detail && detail.id === c.id;

        return (
          <div key={c.id}>
            <div
              className={`flex items-center border-b border-primary/20 py-4 group cursor-pointer transition-colors duration-200 ${selected ? 'bg-surface-container-low' : 'hover:bg-[#f5f1ea]'}`}
              onClick={() => onSelect(c.id)}
              aria-expanded={selected}
            >
              <h3 className={`font-headline-md text-headline-md w-2/5 pr-4 leading-tight group-hover:text-secondary transition-colors ${selected ? 'text-secondary' : ''}`}>
                {feedTopic(c.label)}
              </h3>
              <div className="w-3/5 h-12 relative flex items-center pr-8 md:pr-4">
                {/* Grid lines aligned with the 6-hour ticks */}
                <div className="absolute inset-0 flex justify-between pointer-events-none">
                  {ticks.map((_, i) => (
                    <div key={i} className="w-[1px] h-full bg-primary/10" />
                  ))}
                </div>
                {/* Full-width EKG — beats at article times, flat baseline elsewhere */}
                <div className="absolute inset-0 h-6 flex items-center top-1/2 -translate-y-1/2">
                  <EkgWaveform
                    articleTimes={c.articleTimes}
                    timelineMin={min}
                    timelineSpan={span}
                    selected={selected}
                    intensity={c.intensity}
                  />
                </div>
                <span className="absolute right-0 flex items-center gap-1 font-meta-mono text-meta-mono">
                  ×{c.articleCount}
                  {/* Expand/collapse arrow — mobile only */}
                  <span className={`material-symbols-outlined text-[18px] md:!hidden transition-transform duration-200 ${selected ? 'rotate-180' : ''}`}>
                    expand_more
                  </span>
                </span>
              </div>
            </div>

            {/* Mobile-only inline feed — expands directly beneath the tapped cluster */}
            {showMobileFeed && (
              <div className="md:hidden flex flex-col gap-6 bg-surface-container-low border-b border-primary/20 px-4 pt-2 pb-6">
                <FeedContent cluster={detail} />
              </div>
            )}
          </div>
        );
      })}

      {visibleCount < clusters.length && (
        <button
          onClick={() => setVisibleCount(v => v + 20)}
          className="w-full py-4 text-center font-meta-mono text-meta-mono text-on-surface-variant hover:text-primary hover:bg-[#f5f1ea] border-b border-primary/20 transition-colors uppercase"
        >
          Show More
        </button>
      )}
    </div>
  );
}

/* Shared feed content — title + article list.
   Reused by the desktop sidebar column and the inline mobile expansion. */
function FeedContent({ cluster }) {
  return (
    <>
      {/* Feed title — readable topic name plus a coverage subtitle */}
      <div className="flex flex-col gap-1 border-b-2 border-primary pb-2">
        <h3 className="font-headline-md text-headline-md leading-tight">
          {feedTopic(cluster.label)}
        </h3>
        <div className="font-meta-mono text-meta-mono text-on-surface-variant uppercase flex gap-2">
          <span>Wire Feed</span>
          <span>·</span>
          <span>{cluster.articles.length} {cluster.articles.length === 1 ? 'Article' : 'Articles'}</span>
        </div>
      </div>

      {/* Articles */}
      {cluster.articles.map((a, idx) => {
        const { time, day } = fmtMetaTime(a.publishedAt);
        const isLead = idx === 0;

        return (
          <article
            key={a.id}
            className={`flex flex-col gap-2 group cursor-pointer ${idx < cluster.articles.length - 1 ? 'border-b border-primary/20' : ''} pb-4`}
          >
            {/* Meta line */}
            <div className="font-meta-mono text-meta-mono text-on-surface-variant uppercase flex gap-2">
              <span>{sourceShortName(a.source)}</span>
              <span>·</span>
              <span>{time}</span>
              <span>·</span>
              <span>{day}</span>
            </div>

            {/* Headline */}
            {isLead ? (
              <a
                className="font-headline-md text-headline-md group-hover:underline decoration-1 underline-offset-4"
                href={a.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {a.title}
              </a>
            ) : (
              <a
                className="font-body-lg text-body-lg font-bold group-hover:underline decoration-1 underline-offset-4"
                href={a.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {a.title}
              </a>
            )}

            {/* Summary */}
            {a.summary && (
              <p className="font-body-md text-body-md text-on-surface-variant line-clamp-2">
                {a.summary.slice(0, 220)}{a.summary.length > 220 ? '…' : ''}
              </p>
            )}
          </article>
        );
      })}
    </>
  );
}

/* Desktop detail column — hidden on mobile, where the feed expands inline instead */
function ClusterDetail({ cluster }) {
  if (!cluster) {
    return (
      <div className="hidden md:flex md:col-span-4 flex-col gap-6 md:sticky md:top-24 self-start md:max-h-[calc(100vh-8rem)] overflow-y-auto">
        <div className="font-meta-mono text-meta-mono text-on-surface-variant uppercase text-center py-16">
          SELECT A TOPIC ON THE<br />TIMELINE TO READ ITS<br />WIRE FEED
        </div>
      </div>
    );
  }

  return (
    <div className="hidden md:flex md:col-span-4 flex-col gap-6 md:sticky md:top-24 self-start md:max-h-[calc(100vh-8rem)] overflow-y-auto">
      <FeedContent cluster={cluster} />
    </div>
  );
}

// ---------- page ----------

export default function Home() {
  const [timeline, setTimeline] = useState(null);
  const [error, setError] = useState(null);
  const [enabledSources, setEnabledSources] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [job, setJob] = useState(null);
  const pollRef = useRef(null);
  
  const scrollRef = useRef(null);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [canScroll, setCanScroll] = useState(false);

  // Avoid SSR/client hydration mismatch for locale-dependent dates
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const loadTimeline = useCallback(async () => {
    try {
      const res = await fetch(`${API}/timeline`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();
      setTimeline(data);
      setError(null);
    } catch (e) {
      setError(`Could not load timeline: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    loadTimeline();
    const t = setInterval(loadTimeline, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [loadTimeline]);

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    let cancelled = false;
    fetch(`${API}/clusters/${selectedId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`API ${r.status}`))))
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const allSources = useMemo(() => {
    const set = new Set();
    timeline?.clusters.forEach((c) => c.sources.forEach((s) => set.add(s)));
    return [...set].sort();
  }, [timeline]);

  const enabled = enabledSources ?? new Set(allSources);

  const toggleSource = (s) => {
    const next = new Set(enabled);
    if (next.has(s)) next.delete(s); else next.add(s);
    setEnabledSources(next);
  };

  const visibleClusters = useMemo(() => {
    if (!timeline) return [];
    return timeline.clusters.filter((c) => c.sources.some((s) => enabled.has(s)));
  }, [timeline, enabled]);

  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      setCanScroll(scrollHeight > clientHeight);
      setIsAtBottom(scrollHeight - scrollTop - clientHeight < 50);
    }
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    
    let observer = null;
    if (scrollRef.current && scrollRef.current.firstElementChild) {
      observer = new ResizeObserver(() => checkScroll());
      observer.observe(scrollRef.current.firstElementChild);
    }
    
    return () => {
      window.removeEventListener('resize', checkScroll);
      observer?.disconnect();
    };
  }, [checkScroll, visibleClusters]);

  const totalArticles = useMemo(
    () => timeline?.clusters.reduce((n, c) => n + c.articleCount, 0) ?? 0,
    [timeline],
  );

  const refresh = async () => {
    try {
      setJob({ status: 'starting' });
      const res = await fetch(`${API}/ingest/trigger`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok && res.status !== 409) throw new Error(data.error || `API ${res.status}`);
      const jobId = data.jobId;
      setJob({ status: 'running' });
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const st = await fetch(`${API}/ingest/status/${jobId}`).then((r) => r.json());
          if (st.status === 'completed' || st.status === 'failed') {
            clearInterval(pollRef.current);
            setJob({ status: st.status, detail: st.detail });
            if (st.status === 'completed') loadTimeline();
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch (e) {
      setJob({ status: 'failed', detail: e.message });
    }
  };

  const jobBusy = job && (job.status === 'starting' || job.status === 'running');
  const datelineData = fmtDateline(timeline?.generatedAt ?? Date.now());

  return (
    <>
      {/* Top Navigation */}
      <TopNav onRefresh={refresh} jobBusy={jobBusy} />

      {/* Main Container */}
      <main className="w-full max-w-[1100px] flex flex-col gap-8">

        {/* Masthead */}
        <header className="flex flex-col gap-4">
          <div className="flex justify-between items-end">
            <div className="flex items-baseline gap-4">
              <h2 className="font-headline-lg text-headline-lg hidden md:block">Daily Brief</h2>
              <div className="flex items-center gap-2 bg-secondary text-on-error px-2 py-1 rounded-[2px]">
                <div className="w-2 h-2 bg-on-error rounded-full animate-blink" />
                <span className="font-meta-mono text-meta-mono uppercase">Live</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                className="border border-primary px-3 py-1 font-meta-mono text-meta-mono uppercase hover:bg-surface-container-highest transition-colors flex items-center gap-2 rounded-[2px]"
                onClick={refresh}
                disabled={jobBusy}
              >
                {jobBusy ? 'Refreshing…' : 'Refresh the wire'}
              </button>
              {job && !jobBusy && (
                <span className={`font-meta-mono text-meta-mono uppercase ${job.status === 'completed' ? 'text-primary' : 'text-secondary'}`}>
                  {job.status === 'completed'
                    ? `Done — ${job.detail || 'Updated'}`
                    : `Failed: ${job.detail || ''}`}
                </span>
              )}
            </div>
          </div>

          {/* Hairline rule */}
          <div className="border-b border-primary/20 w-full" />

          {/* Dateline */}
          <div className="font-meta-mono text-meta-mono text-on-surface-variant uppercase flex gap-4" suppressHydrationWarning>
            <span suppressHydrationWarning>{mounted ? datelineData.date : '\u00A0'}</span>
            <span>·</span>
            <span suppressHydrationWarning>{mounted ? datelineData.time : '\u00A0'}</span>
            <span>·</span>
            <span>{totalArticles} ARTICLES</span>
            <span>·</span>
            <span>{allSources.length} WIRES</span>
          </div>
        </header>

        {/* Error banner */}
        {error && (
          <div className="border border-secondary bg-secondary-fixed/20 text-secondary font-meta-mono text-meta-mono uppercase px-4 py-2 rounded-[2px]">
            {error}
          </div>
        )}

        {/* Source Filters */}
        {allSources.length > 0 && (
          <SourceFilter sources={allSources} enabled={enabled} onToggle={toggleSource} />
        )}

        {/* Content Layout — 12-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-column-gap">

          {/* Timeline Column — sticky + internally scrollable so the chart stays
              visible while its rows (and the article feed) scroll. */}
          <div 
            ref={scrollRef}
            onScroll={checkScroll}
            className="md:col-span-8 flex flex-col gap-0 md:border-r border-primary/20 md:pr-column-gap md:sticky md:top-24 self-start md:max-h-[calc(100vh-8rem)] md:overflow-y-auto relative"
          >
            {timeline == null && !error ? (
              <div className="font-meta-mono text-meta-mono text-on-surface-variant uppercase text-center py-10">
                READING THE WIRE…
              </div>
            ) : (
              <Timeline
                clusters={visibleClusters}
                selectedId={selectedId}
                detail={detail}
                onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
              />
            )}
            
            {/* Scroll Indicator */}
            {canScroll && (
              <div className={`sticky bottom-6 left-0 right-0 flex justify-center pointer-events-none transition-opacity duration-300 z-20 ${isAtBottom ? 'opacity-0' : 'opacity-100'}`}>
                <span className="material-symbols-outlined text-primary/40 animate-bounce text-2xl">
                  arrow_downward
                </span>
              </div>
            )}
          </div>

          {/* Cluster Detail Column — narrower (col-span-4) to give headings room.
              Hidden on mobile; there the feed expands inline under the tapped row. */}
          <ClusterDetail cluster={detail} />
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-[1100px] mt-16 pt-12 pb-8 flex flex-col gap-8 border-t-2 border-primary">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {/* Brand Column */}
          <div className="flex flex-col gap-4">
            <span className="font-headline-md text-headline-md leading-none text-primary">News Pulse</span>
            <p className="font-meta-mono text-meta-mono text-on-surface-variant uppercase max-w-[250px] leading-relaxed">
              Algorithmic topic clustering. Real-time news analysis across global syndicates.
            </p>
          </div>

          {/* Sources Column */}
          <div className="flex flex-col gap-4">
            <h4 className="font-meta-mono text-meta-mono font-bold uppercase text-primary tracking-wider">
              Data Sources
            </h4>
            <div className="flex flex-col gap-2 font-meta-mono text-meta-mono text-on-surface-variant uppercase">
              <a href="#" className="hover:text-secondary transition-colors w-fit">Al Jazeera</a>
              <a href="#" className="hover:text-secondary transition-colors w-fit">BBC News</a>
              <a href="#" className="hover:text-secondary transition-colors w-fit">NPR</a>
              <a href="#" className="hover:text-secondary transition-colors w-fit">Reuters</a>
              <a href="#" className="hover:text-secondary transition-colors w-fit">The Guardian</a>
            </div>
          </div>

          {/* System Status Column */}
          <div className="flex flex-col gap-4">
            <h4 className="font-meta-mono text-meta-mono font-bold uppercase text-primary tracking-wider">
              System Status
            </h4>
            <div className="flex flex-col gap-2 font-meta-mono text-meta-mono text-on-surface-variant uppercase">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
                <span>Pipeline Active</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">sync</span>
                <span>Auto-refresh: {Math.round(AUTO_REFRESH_MS / 1000)}s</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">database</span>
                <span>Clustering: Jaccard</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-8 border-t border-primary/10 font-meta-mono text-[10px] text-on-surface-variant uppercase">
          <span suppressHydrationWarning>© {mounted ? new Date().getFullYear() : ''} All rights reserved.</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-primary transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-primary transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-primary transition-colors">API Documentation</a>
          </div>
        </div>
      </footer>
    </>
  );
}
