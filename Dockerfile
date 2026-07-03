FROM node:22-slim

# Install Python + pip for the scraper pipeline
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY scraper/requirements.txt scraper/requirements.txt
RUN python3 -m venv /app/scraper/.venv && \
    /app/scraper/.venv/bin/pip install --no-cache-dir -r scraper/requirements.txt

# Node dependencies
COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev

# Copy source
COPY scraper/ scraper/
COPY backend/ backend/

# Env defaults (overridden by Render env vars)
ENV PORT=4000
ENV PYTHON_BIN=/app/scraper/.venv/bin/python
ENV PIPELINE_SCRIPT=/app/scraper/run_pipeline.py
ENV NEWSPULSE_DB_PATH=/app/data/newspulse.db
ENV CORS_ORIGIN=*

EXPOSE 4000

# Seed the DB on first boot, then start the API
CMD /app/scraper/.venv/bin/python /app/scraper/run_pipeline.py --no-bodies 2>&1; \
    node /app/backend/src/server.js
