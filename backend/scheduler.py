import os
import sys
import uuid
import json
import tempfile
import threading
import subprocess
from datetime import datetime
from sqlalchemy.orm import Session
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from database import SessionLocal
from models import ScraperJob, PostgresConfig, JobLog
from postgres_client import PostgresClient

# In-memory buffer for active runs logs
# format: { run_id: { "logs": [...], "status": "running", "job_id": int, "name": str } }
active_runs = {}

scheduler = BackgroundScheduler()

def get_postgres_client(db: Session) -> PostgresClient | None:
    """Helper to get configured PostgreSQL client."""
    config = db.query(PostgresConfig).first()
    if not config or config.status != "connected":
        return None
    return PostgresClient(
        host=config.host,
        port=config.port,
        database=config.database,
        user=config.user,
        password=config.password
    )

def save_to_pending_sync(db: Session, job_id: int, job_name: str, run_id: str, products: list[dict], error_message: str):
    """Save scraped products array to local SQLite pending_syncs table."""
    try:
        from models import PendingSync
    except ImportError:
        from .models import PendingSync
        
    try:
        pending = PendingSync(
            job_id=job_id,
            job_name=job_name,
            run_id=run_id,
            product_count=len(products),
            products_data=json.dumps(products, ensure_ascii=False),
            error_message=error_message
        )
        db.add(pending)
        db.commit()
    except Exception as e:
        print(f"Error saving to pending sync queue: {e}")

def execute_scraper_subprocess(job_id: int, run_id: str, is_login_only: bool = False):
    """Executes the scraper script in a subprocess, streams logs, and inserts results to PostgreSQL."""
    db = SessionLocal()
    job = db.query(ScraperJob).filter(ScraperJob.id == job_id).first()
    if not job:
        print(f"Job {job_id} not found.")
        db.close()
        return

    # Update job status
    job.status = "running"
    job.last_run = datetime.utcnow()
    db.commit()

    active_runs[run_id] = {
        "logs": [],
        "status": "running",
        "job_id": job_id,
        "name": job.name
    }
    
    def log(msg):
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        formatted = f"[{timestamp}] {msg}"
        active_runs[run_id]["logs"].append(formatted)
        print(f"[{job.name}] {msg}", flush=True)

    log(f"Starting scraper script: {job.script_filename}")

    # Build script path
    scripts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts")
    script_path = os.path.join(scripts_dir, job.script_filename)
    
    if not os.path.exists(script_path):
        log(f"ERROR: Script file not found at {script_path}")
        finish_run(db, job_id, run_id, "failed", 0, active_runs[run_id]["logs"])
        return

    # Create temporary file for output JSON
    temp_fd, temp_file_path = tempfile.mkstemp(suffix=".json", prefix="scrape_")
    os.close(temp_fd)  # Close file descriptor, let subprocess write to path

    cmd = [
        sys.executable,
        script_path
    ]

    if is_login_only:
        cmd.append("--login")
        log("Running in LOGIN mode (headed browser will open for manual login).")
    else:
        cmd.extend([
            "--url", job.search_url,
            "--pages", str(job.max_pages),
            "--output", temp_file_path
        ])
        if job.run_headless:
            cmd.append("--headless")
        log(f"Running command: {' '.join(cmd)}")

    try:
        # Start subprocess
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # Redirect stderr to stdout
            text=True,
            bufsize=1,  # Line buffered
            universal_newlines=True,
            cwd=scripts_dir  # run from scripts directory so profiles are stored correctly
        )

        # Read output line-by-line
        while True:
            line = process.stdout.readline()
            if not line and process.poll() is not None:
                break
            if line:
                log(line.strip())

        return_code = process.wait()
        log(f"Subprocess finished with return code {return_code}")

        if return_code != 0:
            log(f"ERROR: Scraper subprocess exited with error code {return_code}")
            finish_run(db, job_id, run_id, "failed", 0, active_runs[run_id]["logs"])
            return

        if is_login_only:
            log("Login session setup complete.")
            finish_run(db, job_id, run_id, "completed", 0, active_runs[run_id]["logs"])
            return

        # Parse output JSON and save to database
        if not os.path.exists(temp_file_path) or os.path.getsize(temp_file_path) == 0:
            log("ERROR: No output JSON file was generated by the scraper script.")
            finish_run(db, job_id, run_id, "failed", 0, active_runs[run_id]["logs"])
            return

        log("Scraper output detected. Reading products data...")
        with open(temp_file_path, "r", encoding="utf-8") as f:
            products = json.load(f)

        log(f"Successfully loaded {len(products)} products from temporary results.")

        # Insert to Postgres
        pg_client = get_postgres_client(db)
        if not pg_client:
            log("WARNING: PostgreSQL database is not configured or not connected. Scraped products will NOT be saved to Postgres.")
            log("Saving products locally to the Pending Sync Queue.")
            save_to_pending_sync(db, job_id, job.name, run_id, products, "PostgreSQL database not configured or offline")
            finish_run(db, job_id, run_id, "completed", 0, active_runs[run_id]["logs"])
        else:
            log("Connecting to PostgreSQL database and saving products...")
            try:
                inserted = pg_client.insert_products(products)
                log(f"SUCCESS: Inserted {inserted} products into PostgreSQL scraped_products table.")
                finish_run(db, job_id, run_id, "completed", inserted, active_runs[run_id]["logs"])
            except Exception as pg_err:
                log(f"WARNING: PostgreSQL save failed: {pg_err}")
                log("Saving products locally to the Pending Sync Queue.")
                save_to_pending_sync(db, job_id, job.name, run_id, products, str(pg_err))
                finish_run(db, job_id, run_id, "completed", 0, active_runs[run_id]["logs"])

    except Exception as e:
        log(f"EXCEPTION: An unexpected error occurred: {e}")
        finish_run(db, job_id, run_id, "failed", 0, active_runs[run_id].get("logs", []))
    finally:
        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
                print(f"Cleaned up temporary file: {temp_file_path}")
        except Exception as e:
            print(f"Error removing temp file {temp_file_path}: {e}")
        db.close()

def finish_run(db: Session, job_id: int, run_id: str, status: str, count: int, logs: list[str]):
    """Saves job logs and status on execution completion."""
    job = db.query(ScraperJob).filter(ScraperJob.id == job_id).first()
    if job:
        job.status = "idle"
        db.commit()

    log_text = "\n".join(logs)
    job_log = JobLog(
        job_id=job_id,
        run_id=run_id,
        status=status,
        log_output=log_text,
        products_scraped=count
    )
    db.add(job_log)
    db.commit()

    if run_id in active_runs:
        active_runs[run_id]["status"] = status

def run_job_wrapper(job_id: int):
    """APScheduler job target wrapper to trigger the job in a background thread."""
    run_id = str(uuid.uuid4())
    thread = threading.Thread(target=execute_scraper_subprocess, args=(job_id, run_id))
    thread.daemon = True
    thread.start()

def trigger_job_now(job_id: int, is_login_only: bool = False) -> str:
    """Manually run a job immediately in the background. Returns the run_id."""
    run_id = str(uuid.uuid4())
    thread = threading.Thread(target=execute_scraper_subprocess, args=(job_id, run_id, is_login_only))
    thread.daemon = True
    thread.start()
    return run_id

def add_or_update_scheduler_job(job: ScraperJob):
    """Dynamically schedule or update a job in APScheduler."""
    job_id_str = f"job_{job.id}"
    
    try:
        if scheduler.get_job(job_id_str):
            scheduler.remove_job(job_id_str)
    except Exception as e:
        print(f"Error removing job {job_id_str} from scheduler: {e}")

    if not job.enabled or not job.schedule_time:
        return

    try:
        hour, minute = map(int, job.schedule_time.split(":"))
        trigger = CronTrigger(hour=hour, minute=minute)
        scheduler.add_job(
            run_job_wrapper,
            trigger=trigger,
            args=[job.id],
            id=job_id_str,
            replace_existing=True
        )
        print(f"Scheduled job '{job.name}' to run daily at {job.schedule_time}")
    except Exception as e:
        print(f"Failed to schedule job '{job.name}': {e}")

def remove_scheduler_job(job_id: int):
    """Remove a job from APScheduler."""
    job_id_str = f"job_{job_id}"
    try:
        if scheduler.get_job(job_id_str):
            scheduler.remove_job(job_id_str)
            print(f"Removed job {job_id_str} from scheduler")
    except Exception as e:
        print(f"Error removing job {job_id_str}: {e}")

def start_scheduler():
    """Load jobs from database and start APScheduler."""
    if not scheduler.running:
        scheduler.start()
        print("APScheduler started")

    db = SessionLocal()
    try:
        jobs = db.query(ScraperJob).all()
        for job in jobs:
            if job.enabled:
                add_or_update_scheduler_job(job)
    except Exception as e:
        print(f"Error scheduling active jobs on startup: {e}")
    finally:
        db.close()
