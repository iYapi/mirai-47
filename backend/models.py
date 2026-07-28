from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from database import Base

class PostgresConfig(Base):
    __tablename__ = "postgres_config"

    id = Column(Integer, primary_key=True, index=True)  # Singleton (ID=1)
    host = Column(String, nullable=False, default="localhost")
    port = Column(Integer, nullable=False, default=5432)
    database = Column(String, nullable=False, default="scraper_db")
    user = Column(String, nullable=False, default="scraper_user")
    password = Column(String, nullable=False, default="scraper_password")
    status = Column(String, nullable=False, default="not_configured")  # not_configured, connected, failed
    error_message = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ScraperJob(Base):
    __tablename__ = "scraper_jobs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String, unique=True, index=True, nullable=False)
    script_filename = Column(String, nullable=False)  # shopee.py, tokopedia.py, etc.
    search_url = Column(Text, nullable=False)
    max_pages = Column(Integer, default=3)
    schedule_time = Column(String, nullable=True)  # HH:MM format (e.g. "01:00")
    enabled = Column(Boolean, default=False)
    run_headless = Column(Boolean, default=True)  # True = Hidden, False = Open Browser (Enable Header)
    status = Column(String, default="idle")  # idle, running, failed, completed
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class JobLog(Base):
    __tablename__ = "job_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    job_id = Column(Integer, ForeignKey("scraper_jobs.id", ondelete="CASCADE"), nullable=False)
    run_id = Column(String, nullable=False)  # UUID representing this execution
    timestamp = Column(DateTime, default=datetime.utcnow)
    status = Column(String, nullable=False)  # running, failed, completed
    log_output = Column(Text, nullable=True)  # Captured stdout/stderr logs
    products_scraped = Column(Integer, default=0)

class PendingSync(Base):
    __tablename__ = "pending_syncs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    job_id = Column(Integer, ForeignKey("scraper_jobs.id", ondelete="CASCADE"), nullable=False)
    job_name = Column(String, nullable=False)
    run_id = Column(String, nullable=False)
    scraped_at = Column(DateTime, default=datetime.utcnow)
    product_count = Column(Integer, default=0)
    products_data = Column(Text, nullable=False)  # JSON-encoded array of products
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
