# Background Scheduler & Logging Engine

This document details how the backend handles scheduling timings, runs scripts, and streams console execution logs in real-time.

---

## 1. Dynamic Cron Schedules (`APScheduler`)
The dashboard backend uses `APScheduler` (Advanced Python Scheduler) running as a background thread inside FastAPI.
- **Dynamic Registration**: When you toggle a job's schedule on/off or change its HH:MM daily timing in the UI, the FastAPI endpoint executes `add_or_update_scheduler_job` which updates the cron trigger on-the-fly.
- **State Seeding**: On API startup, the database queries SQLite for all active (`enabled = True`) scraper configurations, parsing their HH:MM timings into cron trigger hooks:
```python
hour, minute = map(int, job.schedule_time.split(":"))
trigger = CronTrigger(hour=hour, minute=minute)
scheduler.add_job(..., trigger=trigger)
```

---

## 2. Subprocess Execution & Safety
To prevent anti-bot browser processes from crashing the main API thread or locking backend resources, scraper scripts are run as isolated subprocesses:
- **Process Isolation**: The backend spawns a `subprocess.Popen` task using `sys.executable` (safeguarding package inheritance).
- **Arguments Construction**: It appends the configured search URL, max pages, and output pathways dynamically.
- **Thread Safety**: Runs are wrapped inside `threading.Thread` loops, keeping the FastAPI request handler active.

---

## 3. Real-time Log Streaming & Historical Logs
The panel uses a hybrid logging mechanism to serve both live running console logs and historical logs:

```
                    ┌────────────────────────────┐
                    │      Subprocess Run        │
                    │   (Writes stdout/stderr)   │
                    └─────────────┬──────────────┘
                                  │ (Streams stdout line-by-line)
                                  ▼
                    ┌────────────────────────────┐
                    │     Active Runs Buffer     │◄─── Polled by Frontend
                    │    (In-Memory Dict Logs)   │     for live terminal
                    └─────────────┬──────────────┘
                                  │ (Write at final exit)
                                  ▼
                    ┌────────────────────────────┐
                    │     SQLite Job Logs        │◄─── Loaded for historical
                    │      (JobLog Table)        │     runs viewer
                    └────────────────────────────┘
```

1. **In-Memory Active Runs Buffer (`active_runs`)**:
   While a script is running, the backend stdout reader captures the print streams line-by-line and appends them to a thread-safe dictionary:
   ```python
   active_runs[run_id] = { "logs": [...], "status": "running", "job_id": job_id }
   ```
2. **Terminal Console Polling**:
   When the terminal tab is opened on the UI, the frontend polls the API endpoint `/api/jobs/{id}/logs` every 2 seconds. The endpoint returns the active log list if the job is running.
3. **SQLite Database Persistence**:
   Once the subprocess exits, the thread compiles the cumulative log lines and writes them to the SQLite `JobLog` database schema, clearing the active in-memory buffer. This ensures you can review past logs at any time.
