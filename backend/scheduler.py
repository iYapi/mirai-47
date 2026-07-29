import os
import sys
import uuid
import json
import tempfile
import threading
import subprocess
import random
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from database import SessionLocal
from models import ScraperJob, PostgresConfig, JobLog
from postgres_client import PostgresClient

# In-memory buffer for active runs logs
# format: { run_id: { "logs": [...], "status": "running", "job_id": int, "name": str } }
active_runs = {}
chain_active = False

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
        active_runs[run_id]["process"] = process

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

        # Extract search query keyword from URL query params
        from urllib.parse import urlparse, parse_qs, unquote
        keyword = None
        if job.search_url:
            try:
                parsed_url = urlparse(job.search_url)
                query_params = parse_qs(parsed_url.query)
                for param_name in ["q", "keyword", "query", "search"]:
                    if param_name in query_params:
                        keyword = query_params[param_name][0]
                        # Decode URL characters (like %20) and replace '+' with space
                        keyword = unquote(keyword).replace('+', ' ').strip()
                        break
            except Exception:
                pass

        for p in products:
            if isinstance(p, dict):
                if keyword:
                    p["query_keyword"] = keyword
                p["job_name"] = job.name

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
                log(f"SUCCESS: Inserted {inserted} products into PostgreSQL raw_scrapes table.")
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
        
        if chain_active:
            trigger_next_continuous_job(completed_job_id=job_id)
            
        if job.enabled and job.schedule_time and "-" in job.schedule_time:
            # Reschedule next random time if it's a range schedule
            add_or_update_scheduler_job(job)

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
        if "process" in active_runs[run_id]:
            try:
                del active_runs[run_id]["process"]
            except Exception:
                pass

def run_job_wrapper(job_id: int):
    """APScheduler job target wrapper to trigger the job in a background thread."""
    global chain_active
    chain_active = True
    run_id = str(uuid.uuid4())
    thread = threading.Thread(target=execute_scraper_subprocess, args=(job_id, run_id))
    thread.daemon = True
    thread.start()

def trigger_job_now(job_id: int, is_login_only: bool = False) -> str:
    """Manually run a job immediately in the background. Returns the run_id."""
    if not is_login_only:
        global chain_active
        chain_active = True
    run_id = str(uuid.uuid4())
    thread = threading.Thread(target=execute_scraper_subprocess, args=(job_id, run_id, is_login_only))
    thread.daemon = True
    thread.start()
    return run_id

def calculate_next_random_run(schedule_time: str) -> datetime:
    """Calculate the next execution datetime within the specified range (e.g., '01:00-03:00')."""
    try:
        start_str, end_str = schedule_time.split("-")
        start_h, start_m = map(int, start_str.split(":"))
        end_h, end_m = map(int, end_str.split(":"))
        
        start_total = start_h * 60 + start_m
        end_total = end_h * 60 + end_m
        
        if end_total < start_total:
            # Handle cross-midnight
            end_total += 24 * 60
            
        random_offset = random.randint(start_total, end_total)
        
        # Calculate for today first
        now = datetime.now()
        target_time = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=random_offset)
        
        # If it's already in the past, schedule for tomorrow
        if target_time <= now:
            target_time = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=random_offset)
            
        return target_time
    except Exception as e:
        now = datetime.now()
        return (now + timedelta(days=1)).replace(hour=1, minute=0, second=0, microsecond=0)

def is_chain_active() -> bool:
    global chain_active
    return chain_active

def stop_chain():
    """Interrupts and stops the current scraper execution chain."""
    global chain_active
    chain_active = False
    print("Execution chain interrupted and stopped.")
    
    # Terminate active subprocesses
    for run_id, run_info in list(active_runs.items()):
        if run_info.get("status") == "running" and "process" in run_info:
            try:
                run_info["process"].terminate()
                print(f"Terminated process for run {run_id} due to stop chain.")
            except Exception as e:
                print(f"Error terminating process on stop chain: {e}")

    db = SessionLocal()
    try:
        # Cancel any scheduled continuous jobs
        continuous_jobs = db.query(ScraperJob).filter(ScraperJob.continuous == True).all()
        for job in continuous_jobs:
            job_id_str = f"job_{job.id}"
            try:
                if scheduler.get_job(job_id_str):
                    scheduler.remove_job(job_id_str)
            except Exception:
                pass
            job.next_run = None
        db.commit()
    except Exception as e:
        print(f"Error stopping chain jobs: {e}")

def skip_current_job():
    """
    Skips the currently active job.
    If a job is running, terminates its subprocess to advance the chain.
    If a job is scheduled next, cancels it and advances immediately.
    """
    global chain_active
    if not chain_active:
        return {"success": False, "message": "No active chain to skip."}

    db = SessionLocal()
    try:
        # Case 1: A job is currently running in a subprocess
        running_run_id = None
        running_job_id = None
        for r_id, run_info in list(active_runs.items()):
            if run_info.get("status") == "running" and "process" in run_info:
                running_run_id = r_id
                running_job_id = run_info.get("job_id")
                break

        if running_run_id and running_job_id:
            # Terminate the running subprocess
            process = active_runs[running_run_id]["process"]
            try:
                process.terminate()
                print(f"Terminated running scraper job ID {running_job_id} due to skip action.")
                return {"success": True, "message": "Skipped currently running job."}
            except Exception as e:
                print(f"Error terminating process: {e}")

        # Case 2: No job is running, but one is scheduled next
        continuous_jobs = db.query(ScraperJob).filter(
            ScraperJob.continuous == True,
            ScraperJob.enabled == True
        ).order_by(ScraperJob.position.asc()).all()

        scheduled_job = None
        for job in continuous_jobs:
            job_id_str = f"job_{job.id}"
            if scheduler.get_job(job_id_str):
                scheduled_job = job
                break

        if scheduled_job:
            # Cancel its scheduler job
            job_id_str = f"job_{scheduled_job.id}"
            try:
                scheduler.remove_job(job_id_str)
            except Exception:
                pass
            scheduled_job.next_run = None
            db.commit()

            # Advance to next job in sequence
            print(f"Cancelled scheduled job ID {scheduled_job.id} due to skip. Advancing chain...")
            trigger_next_continuous_job(completed_job_id=scheduled_job.id)
            return {"success": True, "message": f"Skipped scheduled job '{scheduled_job.name}'."}

        return {"success": False, "message": "No running or scheduled job to skip."}

    except Exception as e:
        print(f"Error skipping current job: {e}")
        return {"success": False, "message": str(e)}
    finally:
        db.close()

def trigger_next_continuous_job(completed_job_id: int):
    """
    Selects the next enabled continuous scraper job after completed_job_id
    and schedules it to run if the chain is active.
    """
    global chain_active
    if not chain_active:
        print("Execution chain is inactive. Stopping.")
        return

    import random
    db = SessionLocal()
    try:
        continuous_jobs = db.query(ScraperJob).filter(
            ScraperJob.continuous == True,
            ScraperJob.enabled == True
        ).order_by(ScraperJob.position.asc()).all()

        if not continuous_jobs:
            chain_active = False
            return

        # Find the index of the completed job in the current ordered sequence
        completed_index = -1
        for idx, job in enumerate(continuous_jobs):
            if job.id == completed_job_id:
                completed_index = idx
                break

        # If completed job is not in the continuous list (e.g. it was the trigger job), start at 0
        if completed_index != -1:
            next_index = completed_index + 1
        else:
            next_index = 0

        next_job = None
        if next_index < len(continuous_jobs):
            next_job = continuous_jobs[next_index]

        if not next_job:
            print("Reached the end of the chain. Chain completed.")
            chain_active = False
            # Clear continuous jobs' next_run
            for job in continuous_jobs:
                job.next_run = None
            db.commit()
            return

        # Pick random delay: 0 to 3 minutes (0 to 180 seconds)
        delay_seconds = random.randint(0, 180)
        next_run_time = datetime.now() + timedelta(seconds=delay_seconds)
        job_id_str = f"job_{next_job.id}"

        # Clear existing scheduled runs for all continuous jobs to keep only one active trigger
        for job in continuous_jobs:
            j_id_str = f"job_{job.id}"
            try:
                if scheduler.get_job(j_id_str):
                    scheduler.remove_job(j_id_str)
            except Exception:
                pass
            job.next_run = None
        
        # Schedule the next job in the chain
        try:
            scheduler.add_job(
                run_job_wrapper,
                trigger='date',
                run_date=next_run_time,
                args=[next_job.id],
                id=job_id_str,
                replace_existing=True
            )
            next_job.next_run = next_run_time
            db.commit()
            print(f"Scheduled next job in chain: '{next_job.name}' (ID: {next_job.id}) in {delay_seconds} seconds (at {next_run_time})")
        except Exception as e:
            print(f"Error scheduling next chain job {next_job.name}: {e}")

    except Exception as e:
        print(f"Error inside trigger_next_continuous_job: {e}")
    finally:
        db.close()

def add_or_update_scheduler_job(job: ScraperJob):
    """Dynamically schedule or update a job in APScheduler (supports specific HH:MM or range HH:MM-HH:MM)."""
    job_id_str = f"job_{job.id}"
    
    try:
        if scheduler.get_job(job_id_str):
            scheduler.remove_job(job_id_str)
    except Exception as e:
        print(f"Error removing job {job_id_str} from scheduler: {e}")

    if not job.enabled:
        return

    if job.continuous:
        # Continuous jobs are run sequentially in the chain trigger loop; they are not scheduled independently.
        return

    if not job.schedule_time:
        return

    # Check if range or specific time
    if "-" in job.schedule_time:
        # Range schedule (e.g. 01:00-03:00)
        next_run_time = calculate_next_random_run(job.schedule_time)
        try:
            scheduler.add_job(
                run_job_wrapper,
                trigger='date',
                run_date=next_run_time,
                args=[job.id],
                id=job_id_str,
                replace_existing=True
            )
            print(f"Scheduled range job '{job.name}' for a random occurrence at {next_run_time}")
            
            # Save the next run time in SQLite database so the UI can show it
            db = SessionLocal()
            db_job = db.query(ScraperJob).filter(ScraperJob.id == job.id).first()
            if db_job:
                db_job.next_run = next_run_time
                db.commit()
            db.close()
        except Exception as e:
            print(f"Failed to schedule range job '{job.name}': {e}")
    else:
        # Specific time schedule (e.g. 01:00)
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
    is_continuous = False
    db = SessionLocal()
    try:
        db_job = db.query(ScraperJob).filter(ScraperJob.id == job_id).first()
        if db_job:
            is_continuous = db_job.continuous
    except Exception:
        pass
    finally:
        db.close()

    try:
        if scheduler.get_job(job_id_str):
            scheduler.remove_job(job_id_str)
            print(f"Removed job {job_id_str} from scheduler")
            if is_continuous:
                trigger_next_continuous_job(completed_job_id=job_id)
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
        # Non-continuous jobs scheduled first
        for job in jobs:
            if job.enabled and not job.continuous:
                add_or_update_scheduler_job(job)
    except Exception as e:
        print(f"Error scheduling active jobs on startup: {e}")
    finally:
        db.close()
