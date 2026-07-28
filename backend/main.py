import os
import shutil
from typing import Optional
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel

from .database import engine, Base, get_db, SessionLocal
from .models import PostgresConfig, ScraperJob, JobLog
from .postgres_client import PostgresClient
from .scheduler import (
    start_scheduler,
    add_or_update_scheduler_job,
    remove_scheduler_job,
    trigger_job_now,
    active_runs
)

# Initialize database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Cron Scraping Manager Dashboard API")

# Setup CORS to allow React Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development; can narrow down if needed
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts")
os.makedirs(SCRIPTS_DIR, exist_ok=True)

# Pydantic Schemas
class PostgresConfigSchema(BaseModel):
    host: str
    port: int
    database: str
    user: str
    password: str

class ScraperJobCreate(BaseModel):
    name: str
    script_filename: str
    search_url: str
    max_pages: Optional[int] = 3
    schedule_time: Optional[str] = "01:00"
    enabled: Optional[bool] = False
    run_headless: Optional[bool] = True

class ScraperJobUpdate(BaseModel):
    name: Optional[str] = None
    search_url: Optional[str] = None
    max_pages: Optional[int] = None
    schedule_time: Optional[str] = None
    enabled: Optional[bool] = None
    run_headless: Optional[bool] = None

# Seed Database on Startup
@app.on_event("startup")
def startup_event():
    db = SessionLocal()
    try:
        # 1. Seed Postgres Config (Singleton row ID=1)
        config = db.query(PostgresConfig).filter(PostgresConfig.id == 1).first()
        if not config:
            config = PostgresConfig(id=1)
            db.add(config)
            db.commit()

        # 2. Seed Default Scraping Jobs
        shopee_job = db.query(ScraperJob).filter(ScraperJob.script_filename == "shopee.py").first()
        if not shopee_job:
            shopee_job = ScraperJob(
                name="Shopee Scraper (Default)",
                script_filename="shopee.py",
                search_url="https://shopee.co.id/search?keyword=rtx%203050",
                max_pages=3,
                schedule_time="01:00",
                enabled=False,
                run_headless=True
            )
            db.add(shopee_job)

        tokopedia_job = db.query(ScraperJob).filter(ScraperJob.script_filename == "tokopedia.py").first()
        if not tokopedia_job:
            tokopedia_job = ScraperJob(
                name="Tokopedia Scraper (Default)",
                script_filename="tokopedia.py",
                search_url="https://www.tokopedia.com/search?navsource=home&q=rtx+3050&source=universe&st=product",
                max_pages=3,
                schedule_time="01:00",
                enabled=False,
                run_headless=True
            )
            db.add(tokopedia_job)

        db.commit()

        # 3. Start Scheduler
        start_scheduler()
    except Exception as e:
        print(f"Error seeding database and starting scheduler: {e}")
    finally:
        db.close()

# Postgres connection helper
def get_active_pg_client(db: Session = Depends(get_db)) -> Optional[PostgresClient]:
    config = db.query(PostgresConfig).filter(PostgresConfig.id == 1).first()
    if not config or config.status != "connected":
        return None
    return PostgresClient(
        host=config.host,
        port=config.port,
        database=config.database,
        user=config.user,
        password=config.password
    )

# --- PostgreSQL Config API ---

@app.get("/api/postgres/config")
def get_postgres_config(db: Session = Depends(get_db)):
    config = db.query(PostgresConfig).filter(PostgresConfig.id == 1).first()
    if not config:
        return {"status": "not_configured"}
    return config

@app.post("/api/postgres/config")
def update_postgres_config(payload: PostgresConfigSchema, db: Session = Depends(get_db)):
    config = db.query(PostgresConfig).filter(PostgresConfig.id == 1).first()
    if not config:
        config = PostgresConfig(id=1)
        db.add(config)

    config.host = payload.host
    config.port = payload.port
    config.database = payload.database
    config.user = payload.user
    config.password = payload.password

    # Test the connection immediately
    client = PostgresClient(payload.host, payload.port, payload.database, payload.user, payload.password)
    success, msg = client.test_connection()
    if success:
        config.status = "connected"
        config.error_message = None
        # Initialize tables
        client.init_db()
    else:
        config.status = "failed"
        config.error_message = msg

    db.commit()
    db.refresh(config)
    return config

@app.post("/api/postgres/test")
def test_postgres_config(payload: PostgresConfigSchema):
    client = PostgresClient(payload.host, payload.port, payload.database, payload.user, payload.password)
    success, msg = client.test_connection()
    return {"success": success, "message": msg}

# --- Scraper Jobs API ---

@app.get("/api/jobs")
def get_jobs(db: Session = Depends(get_db)):
    jobs = db.query(ScraperJob).all()
    # Populate next run time dynamically if active in APScheduler
    from .scheduler import scheduler
    for job in jobs:
        job_id_str = f"job_{job.id}"
        sch_job = scheduler.get_job(job_id_str)
        if sch_job and sch_job.next_run_time:
            job.next_run = sch_job.next_run_time.replace(tzinfo=None)
        else:
            job.next_run = None
    return jobs

@app.post("/api/jobs")
def create_job(payload: ScraperJobCreate, db: Session = Depends(get_db)):
    # Check if script file exists
    script_path = os.path.join(SCRIPTS_DIR, payload.script_filename)
    if not os.path.exists(script_path):
        raise HTTPException(
            status_code=400,
            detail=f"Script file '{payload.script_filename}' does not exist. Please upload it first."
        )

    # Check for name uniqueness
    existing = db.query(ScraperJob).filter(ScraperJob.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="A job with this name already exists.")

    job = ScraperJob(
        name=payload.name,
        script_filename=payload.script_filename,
        search_url=payload.search_url,
        max_pages=payload.max_pages,
        schedule_time=payload.schedule_time,
        enabled=payload.enabled,
        run_headless=payload.run_headless
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    if job.enabled:
        add_or_update_scheduler_job(job)

    return job

@app.put("/api/jobs/{id}")
def update_job(id: int, payload: ScraperJobUpdate, db: Session = Depends(get_db)):
    job = db.query(ScraperJob).filter(ScraperJob.id == id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if payload.name is not None:
        job.name = payload.name
    if payload.search_url is not None:
        job.search_url = payload.search_url
    if payload.max_pages is not None:
        job.max_pages = payload.max_pages
    if payload.schedule_time is not None:
        job.schedule_time = payload.schedule_time
    if payload.enabled is not None:
        job.enabled = payload.enabled
    if payload.run_headless is not None:
        job.run_headless = payload.run_headless

    db.commit()
    db.refresh(job)

    # Dynamic scheduler sync
    if job.enabled:
        add_or_update_scheduler_job(job)
    else:
        remove_scheduler_job(job.id)

    return job

@app.delete("/api/jobs/{id}")
def delete_job(id: int, db: Session = Depends(get_db)):
    job = db.query(ScraperJob).filter(ScraperJob.id == id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    # Prevent deleting default scripts
    if job.script_filename in ["shopee.py", "tokopedia.py"]:
        raise HTTPException(status_code=400, detail="Cannot delete default scraper jobs.")

    remove_scheduler_job(job.id)
    db.delete(job)
    db.commit()
    return {"success": True, "message": "Job deleted."}

# --- Script Upload Endpoint ---

@app.post("/api/jobs/upload")
def upload_script(file: UploadFile = File(...)):
    if not file.filename.endswith(".py"):
        raise HTTPException(status_code=400, detail="Only Python (.py) scripts are allowed.")

    filename = file.filename
    # Prevent overwriting default scripts
    if filename in ["shopee.py", "tokopedia.py"] and os.path.exists(os.path.join(SCRIPTS_DIR, filename)):
        # Let's verify if the script directories already contain the base file.
        # Overwriting custom ones is fine, but warning the user or renaming is safer.
        pass

    target_path = os.path.join(SCRIPTS_DIR, filename)
    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"success": True, "filename": filename}

# --- Job Execution API ---

@app.post("/api/jobs/{id}/run")
def run_job(id: int, db: Session = Depends(get_db)):
    job = db.query(ScraperJob).filter(ScraperJob.id == id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status == "running":
        raise HTTPException(status_code=400, detail="Job is already running.")

    run_id = trigger_job_now(job.id, is_login_only=False)
    return {"success": True, "run_id": run_id, "status": "running"}

@app.post("/api/jobs/{id}/login")
def login_job(id: int, db: Session = Depends(get_db)):
    job = db.query(ScraperJob).filter(ScraperJob.id == id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status == "running":
        raise HTTPException(status_code=400, detail="Job is already running.")

    # Open headed browser to run login
    run_id = trigger_job_now(job.id, is_login_only=True)
    return {"success": True, "run_id": run_id, "status": "running", "info": "Headed browser opening for login."}

# --- Real-time & Historical Logs API ---

@app.get("/api/jobs/active-runs")
def get_active_runs():
    return {rid: {"status": details["status"], "name": details["name"], "job_id": details["job_id"]} for rid, details in active_runs.items()}

@app.get("/api/runs/{run_id}/logs")
def get_run_logs(run_id: str, db: Session = Depends(get_db)):
    # Check in-memory logs first (if active)
    if run_id in active_runs:
        return {
            "run_id": run_id,
            "status": active_runs[run_id]["status"],
            "logs": active_runs[run_id]["logs"]
        }

    # Fetch from SQLite database history
    log_db = db.query(JobLog).filter(JobLog.run_id == run_id).first()
    if not log_db:
        raise HTTPException(status_code=404, detail="Run ID not found.")

    return {
        "run_id": run_id,
        "status": log_db.status,
        "logs": log_db.log_output.split("\n") if log_db.log_output else []
    }

@app.get("/api/jobs/{id}/logs")
def get_latest_job_logs(id: int, db: Session = Depends(get_db)):
    # Check if there is an active run for this job
    for run_id, run_info in active_runs.items():
        if run_info["job_id"] == id and run_info["status"] == "running":
            return {
                "active": True,
                "run_id": run_id,
                "status": run_info["status"],
                "logs": run_info["logs"]
            }

    # Otherwise get latest historical run
    latest = db.query(JobLog).filter(JobLog.job_id == id).order_by(JobLog.timestamp.desc()).first()
    if not latest:
        return {"active": False, "run_id": None, "status": "idle", "logs": ["No run logs found for this job."]}

    return {
        "active": False,
        "run_id": latest.run_id,
        "status": latest.status,
        "logs": latest.log_output.split("\n") if latest.log_output else []
    }

@app.get("/api/logs")
def get_historical_logs(limit: int = 50, db: Session = Depends(get_db)):
    logs = db.query(JobLog, ScraperJob.name).join(ScraperJob, JobLog.job_id == ScraperJob.id).order_by(JobLog.timestamp.desc()).limit(limit).all()
    
    return [
        {
            "id": log.JobLog.id,
            "job_id": log.JobLog.job_id,
            "job_name": log.name,
            "run_id": log.JobLog.run_id,
            "timestamp": log.JobLog.timestamp,
            "status": log.JobLog.status,
            "products_scraped": log.JobLog.products_scraped
        }
        for log in logs
    ]

# --- PostgreSQL Scraped Products Explorer API ---

@app.get("/api/products")
def get_scraped_products(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    source: Optional[str] = None,
    search: Optional[str] = None,
    pg_client: Optional[PostgresClient] = Depends(get_active_pg_client)
):
    if not pg_client:
        return {"products": [], "total": 0, "status": "PostgreSQL is not configured or not connected."}

    products, total = pg_client.get_products(limit=limit, offset=offset, source=source, search=search)
    return {"products": products, "total": total, "status": "connected"}

# --- Dashboard Stats API ---

@app.get("/api/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    config = db.query(PostgresConfig).filter(PostgresConfig.id == 1).first()
    postgres_status = config.status if config else "not_configured"
    
    total_jobs = db.query(ScraperJob).count()
    active_jobs = sum(1 for r in active_runs.values() if r["status"] == "running")

    # Get total scraped items from Postgres if connected
    total_scraped = 0
    if postgres_status == "connected" and config:
        pg_client = PostgresClient(config.host, config.port, config.database, config.user, config.password)
        try:
            conn = pg_client._get_connection()
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM scraped_products")
                total_scraped = cur.fetchone()[0]
            conn.close()
        except Exception:
            pass

    return {
        "postgres_status": postgres_status,
        "total_jobs": total_jobs,
        "active_jobs": active_jobs,
        "total_products_scraped": total_scraped
    }
