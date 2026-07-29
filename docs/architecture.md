# System Architecture

The **Mirai-47** is organized into three decoupled layers: a FastAPI backend server, a Vite + React single-page application frontend, and an external PostgreSQL database pipeline for scraper storage.

```
                  ┌──────────────────────┐
                  │   React Dashboard    │
                  │  (Vite, Tailwind v4) │
                  └──────────┬───────────┘
                             │ (REST APIs)
                             ▼
                  ┌──────────────────────┐
                  │   FastAPI Backend    │
                  │   (Uvicorn, Port)    │
                  └─────┬──────────┬─────┘
                        │          │
         (SQLite Read/  │          │ (Triggers Subprocesses)
         Write)         ▼          ▼
           ┌──────────────┐      ┌──────────────────────┐
           │ cron_panel.db│      │ Scraper Subprocesses │
           │ (SQLite Metadata)   │ (Shopee, Tokopedia)  │
           └──────────────┘      └──────────┬───────────┘
                                            │
                                            │ (JSON Pipeline)
                                            ▼
                                 ┌──────────────────────┐
                                 │ External PostgreSQL  │
                                 │  (Scraped Products)  │
                                 └──────────────────────┘
```

---

## 1. Frontend: React Dashboard
- Built with **React 18** and compiled using **Vite**.
- Styled with **Tailwind CSS v4** for a clean, modern, mobile-friendly interface.
- Communicates with the backend using async fetch REST queries.
- Incorporates polling intervals (2–4 seconds) to fetch active console output streams and live scraper run status without requiring complex socket setups.

---

## 2. Backend: FastAPI Web Service
- Implemented in **FastAPI** to provide structured JSON endpoints.
- **SQLite Database (`cron_panel.db`)**: Used as a local, lightweight data store for metadata:
  - Scraper configurations (target search URLs, daily schedule times, headless visibility).
  - PostgreSQL credentials and connection profiles.
  - Job execution histories and console print text logs.
- **APScheduler**: Manages the dynamic triggers. Job times are saved to SQLite and dynamically registered or unregistered on-the-fly without service restarts.

---

## 3. Scrapers subprocesses
- Scrapers are executed as standalone subprocesses utilizing `sys.executable` (to inherit the runtime environment packages).
- **Shopee Scraper**: Built using `undetected-chromedriver` (Selenium evasion mode) to bypass captcha verification walls.
- **Tokopedia Scraper**: Built using Playwright Sync API for fast and lightweight parsing.
- Once finished, the scraper scripts output their clean product arrays to a temporary JSON file.

---

## 4. PostgreSQL Database Pipeline
- Configured dynamically via the frontend.
- When a scraper completes successfully, the backend reads the temporary JSON data and uses the dynamic connection driver (`postgres_client.py`) to connect to your PostgreSQL database.
- It verifies and initializes the table `raw_scrapes` automatically and bulk inserts all scraped entries.
