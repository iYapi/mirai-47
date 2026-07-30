# Mirai-47

A premium, responsive scraping manager dashboard built to run natively on Linux PC (or any desktop system). It schedules, triggers, logs, and manages custom python scraping scripts (including Chromium Selenium and Playwright), automatically pipelines results into an external PostgreSQL database, and provides a sleek live terminal monitor.

## Key Features
- **Dynamic Script Uploader**: Upload or write new python scripts directly from the panel. Scripts are executed as isolated subprocesses with real-time log capturing.
- **Auto-Sync Pipeline**: Automatically saves scraper output (JSON arrays) into your configured external PostgreSQL database.
- **Enable Header Flag**: Run scrapers in "headed" mode (showing browser windows) directly on your Linux desktop to monitor actions or handle captchas.
- **Login Session Setup**: Open Chrome/Chromium headed with profile session persistence to manually authenticate on Shopee or Tokopedia.
- **Mobile Responsive**: Fully responsive layout optimized for desktop and Android devices.

---

## 📂 Directory Layout
```
.
├── backend/
│   ├── main.py                 # FastAPI Web API
│   ├── database.py             # SQLite config (panel metadata)
│   ├── models.py               # SQLite Models (jobs, logs, configurations)
│   ├── scheduler.py            # Subprocess runner & APScheduler manager
│   ├── postgres_client.py      # PostgreSQL driver for scraping insertions
│   ├── requirements.txt        # Python package lists
│   └── scripts/                # Dynamic script folders (saves uploaded python scripts)
│       ├── shopee.py           # Default Shopee Selenium crawler
│       └── tokopedia.py        # Default Tokopedia Playwright crawler
├── docs/                       # Comprehensive system documentation
│   ├── architecture.md         # System structure and block diagrams
│   ├── scraper_contract.md     # Command-line arguments & JSON schema rules
│   ├── scheduler_logs.md       # Real-time log capture and APScheduler triggers
│   └── postgres_sync.md        # PostgreSQL Dynamic Config & migrations
├── frontend/                   # React + Vite + Tailwind CSS v4
│   ├── src/
│   │   ├── App.jsx             # React Dashboard Panel
│   │   ├── index.css           # Tailwind v4 imports
│   │   └── main.jsx
│   └── package.json
└── docker-compose.yml          # Container configuration for server deploy
```

---

## 🚀 Running Natively on Linux Desktop (Recommended)

Running the panel natively is the best way to utilize the **Headed Browser Mode (Enable Header)** and **Login Setup** features because it allows the scraper's Chrome/Chromium browser window to pop up directly on your desktop screen.

### Step 1: Backend Setup
Ensure you have Python 3.10+ and Google Chrome installed on your Linux PC.
```bash
# Navigate to backend and install packages
cd backend
pip install -r requirements.txt

# Install Playwright browser binaries
playwright install chromium
```

Start the FastAPI backend:
```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
The API server will run at `http://localhost:8000`.

### Step 2: Frontend Setup
Ensure you have Node.js (v18+) installed.
```bash
# Navigate to frontend and install dependencies
cd ../frontend
npm install

# Start Vite developer server
npm run dev
```
The React dashboard will run at `http://localhost:5173`. Open this URL in your web browser.

---

## 🛠 Scraper Script CLI Contract & Rules

You can add any custom python scraping script directly through the panel. To make it compatible with the manager, your script must accept these command-line arguments:

1. **Arguments Contract**:
   - `--url "<url>"`: The search URL or query to scrape.
   - `--pages <int>`: Max page counts to scan.
   - `--output "<filepath>"`: The filepath where your script **must** write its final scraped products list as a JSON array.
   - `--headless` (flag): Run browser hidden. If absent, the script should run headed (showing the browser).
   - `--login` (flag): Open headed browser to let the user log in manually, save cookies to the profile folder, then exit.

2. **Output Format**:
   The JSON array written to the `--output` filepath must consist of objects with the following schema:
   ```json
   [
     {
       "product_name": "Product Name",
       "original_price": "Rp1.250.000",
       "original_price_cleaned": 1250000,
       "discount_price": "Rp1.000.000",
       "discount_price_cleaned": 1000000,
       "discount_percentage": "20%",
       "rating": "4.8",
       "rating_cleaned": 4.8,
       "sold_count": "100+ terjual",
       "sold_count_cleaned": 100,
       "store_name": "Shop Name",
       "store_location": "Jakarta",
       "store_type": "Official Store",
       "source": "tokopedia",
       "page": 1,
       "scraped_at": "2026-07-28T07:50:00Z"
     }
   ]
   ```

---

## 🔐 Session Cookie Manual Login Procedure
If a scraper fails due to bot detection (captchas or missing sessions):
1. Navigate to the **Manage Scripts** tab on the dashboard.
2. Click **Login Setup** for the respective scraper (Shopee or Tokopedia).
3. A headed Chrome/Chromium window will open on your screen.
4. Log in to your account manually and complete any OTP or slide captchas.
5. Once logged in and on the homepage, return to your terminal running the backend python process, and press **[ENTER]**.
6. The browser will close, saving cookies to the profile directories (`backend/scripts/shopee_profile_uc/` or `backend/scripts/tokopedia_profile/`) for future scheduled runs.

---

## 🛢 External PostgreSQL Database Integration
1. Navigate to the **Database Config** tab.
2. Enter your external PostgreSQL Host, Port, Database name, Username, and Password.
3. Click **Test Connection** to verify connection.
4. Click **Save Config**.
5. Once saved, the manager automatically validates and seeds the `raw_scrapes` table schema. Future scraping runs will auto-sync products into this database. You can inspect all items on the **Data Explorer** tab.

---

## 🐳 Running with Docker Compose (Alternative)
If you want to run the dashboard inside docker containers:
```bash
# Build and run containers
docker-compose up --build
```
- Frontend: `http://localhost`
- Backend API: `http://localhost:8000`

> [!NOTE]
> When running inside Docker, headed mode browser popups require X11 display server sharing. Ensure your host system's `DISPLAY` environment variable is exported and X11 permissions allow local container connections (`xhost +local:docker`).
