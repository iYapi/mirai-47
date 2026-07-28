import React, { useState, useEffect, useRef } from 'react';
import {
  Server,
  Play,
  UserCheck,
  Settings,
  Database,
  Terminal,
  RefreshCw,
  Search,
  Plus,
  Trash2,
  Edit2,
  FileCode,
  CheckCircle,
  XCircle,
  Eye,
  AlertTriangle,
  FolderOpen,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

const API_BASE = 'http://localhost:8000/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState({
    postgres_status: 'not_configured',
    total_jobs: 0,
    active_jobs: 0,
    total_products_scraped: 0
  });

  const [postgresConfig, setPostgresConfig] = useState({
    host: '',
    port: 5432,
    database: '',
    user: '',
    password: '',
    status: 'not_configured',
    error_message: ''
  });

  const [jobs, setJobs] = useState([]);
  const [activeRunsState, setActiveRunsState] = useState({});
  const [selectedJobLogs, setSelectedJobLogs] = useState(null); // Job ID
  const [logs, setLogs] = useState([]);
  const [isLogsActive, setIsLogsActive] = useState(false);
  const [logRunId, setLogRunId] = useState(null);

  // Products Explorer
  const [products, setProducts] = useState([]);
  const [productsCount, setProductsCount] = useState(0);
  const [filterSource, setFilterSource] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Pending Sync state
  const [pendingSyncs, setPendingSyncs] = useState([]);
  const [isRetryingSyncId, setIsRetryingSyncId] = useState(null);

  // Modals & Forms
  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const [showEditJobModal, setShowEditJobModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFilename, setUploadedFilename] = useState('');
  
  const [newJob, setNewJob] = useState({
    name: '',
    script_filename: '',
    search_url: '',
    max_pages: 3,
    schedule_time: '01:00',
    enabled: false,
    run_headless: true
  });

  const [editJobForm, setEditJobForm] = useState(null);

  const [feedbackMsg, setFeedbackMsg] = useState({ type: '', text: '' });
  const terminalEndRef = useRef(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Fetch Initial Data
  useEffect(() => {
    fetchStats();
    fetchPostgresConfig();
    fetchJobs();
    fetchPendingSyncs();
  }, []);

  // Polling for Job status, stats and logs
  useEffect(() => {
    const statusInterval = setInterval(() => {
      fetchJobsStatusOnly();
      fetchStats();
      fetchPendingSyncs();
    }, 4000);

    return () => clearInterval(statusInterval);
  }, []);

  // Polling for active running logs
  useEffect(() => {
    let logsInterval = null;
    if (selectedJobLogs) {
      fetchLogs(selectedJobLogs);
      logsInterval = setInterval(() => {
        fetchLogs(selectedJobLogs);
      }, 2000);
    }
    return () => {
      if (logsInterval) clearInterval(logsInterval);
    };
  }, [selectedJobLogs]);

  // Load Products when tab or filters change
  useEffect(() => {
    if (activeTab === 'explorer') {
      fetchProducts();
    }
  }, [activeTab, filterSource, currentPage]);

  const showFeedback = (type, text) => {
    setFeedbackMsg({ type, text });
    setTimeout(() => setFeedbackMsg({ type: '', text: '' }), 5000);
  };

  const fetchPendingSyncs = async () => {
    try {
      const res = await fetch(`${API_BASE}/pending-syncs`);
      const data = await res.json();
      setPendingSyncs(data || []);
    } catch (err) {
      console.error('Error fetching pending syncs:', err);
    }
  };

  const retryPendingSync = async (id) => {
    setIsRetryingSyncId(id);
    try {
      const res = await fetch(`${API_BASE}/pending-syncs/${id}/retry`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', data.message || 'Data synchronized successfully!');
        fetchPendingSyncs();
        fetchStats();
      } else {
        showFeedback('error', data.detail || 'Sync failed.');
        fetchPendingSyncs();
      }
    } catch (err) {
      showFeedback('error', 'API server unreachable.');
    } finally {
      setIsRetryingSyncId(null);
    }
  };

  const discardPendingSync = async (id) => {
    if (!confirm('Are you sure you want to discard this pending scraped data? It will be permanently deleted.')) return;
    try {
      const res = await fetch(`${API_BASE}/pending-syncs/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showFeedback('success', 'Pending sync data discarded.');
        fetchPendingSyncs();
      } else {
        showFeedback('error', 'Failed to discard record.');
      }
    } catch (err) {
      showFeedback('error', 'Server error.');
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchPostgresConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/postgres/config`);
      const data = await res.json();
      if (data) {
        setPostgresConfig(data);
      }
    } catch (err) {
      console.error('Error fetching config:', err);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`);
      const data = await res.json();
      setJobs(data);
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  };

  const fetchJobsStatusOnly = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`);
      const data = await res.json();
      // Only update statuses so form states are not wiped out
      setJobs(prevJobs => {
        return prevJobs.map(pj => {
          const fresh = data.find(d => d.id === pj.id);
          if (fresh) {
            return {
              ...pj,
              status: fresh.status,
              next_run: fresh.next_run,
              last_run: fresh.last_run,
              enabled: fresh.enabled
            };
          }
          return pj;
        });
      });
    } catch (err) {
      console.error('Error updates:', err);
    }
  };

  const fetchLogs = async (jobId) => {
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}/logs`);
      const data = await res.json();
      setLogs(data.logs || []);
      setIsLogsActive(data.active || false);
      setLogRunId(data.run_id);
    } catch (err) {
      console.error('Error logs:', err);
    }
  };

  const fetchProducts = async () => {
    const offset = (currentPage - 1) * itemsPerPage;
    let url = `${API_BASE}/products?limit=${itemsPerPage}&offset=${offset}`;
    if (filterSource) url += `&source=${filterSource}`;
    if (filterSearch) url += `&search=${encodeURIComponent(filterSearch)}`;
    
    try {
      const res = await fetch(url);
      const data = await res.json();
      setProducts(data.products || []);
      setProductsCount(data.total || 0);
    } catch (err) {
      console.error('Error products:', err);
    }
  };

  const testPostgresConfig = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/postgres/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postgresConfig)
      });
      const data = await res.json();
      if (data.success) {
        showFeedback('success', 'Database connection test passed!');
      } else {
        showFeedback('error', `Connection failed: ${data.message}`);
      }
    } catch (err) {
      showFeedback('error', 'API server unreachable.');
    }
  };

  const savePostgresConfig = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/postgres/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postgresConfig)
      });
      const data = await res.json();
      setPostgresConfig(data);
      if (data.status === 'connected') {
        showFeedback('success', 'PostgreSQL configuration saved & connected successfully!');
      } else {
        showFeedback('error', `Saved but connection failed: ${data.error_message}`);
      }
      fetchStats();
    } catch (err) {
      showFeedback('error', 'Failed to save config.');
    }
  };

  // Jobs Manager Trigger Actions
  const runJobNow = async (jobId) => {
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}/run`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', 'Scraper started successfully in background.');
        setSelectedJobLogs(jobId);
        setActiveTab('logs');
        fetchJobsStatusOnly();
      } else {
        showFeedback('error', data.detail || 'Failed to start job.');
      }
    } catch (err) {
      showFeedback('error', 'Server error.');
    }
  };

  const loginJob = async (jobId) => {
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}/login`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', 'Browser launched on desktop for manual login.');
        setSelectedJobLogs(jobId);
        setActiveTab('logs');
        fetchJobsStatusOnly();
      } else {
        showFeedback('error', data.detail || 'Failed to trigger login browser.');
      }
    } catch (err) {
      showFeedback('error', 'Server error.');
    }
  };

  const toggleJobEnabled = async (job) => {
    try {
      const res = await fetch(`${API_BASE}/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !job.enabled })
      });
      if (res.ok) {
        showFeedback('success', `Schedule ${!job.enabled ? 'enabled' : 'disabled'} for ${job.name}.`);
        fetchJobs();
      }
    } catch (err) {
      showFeedback('error', 'Server error.');
    }
  };

  const toggleJobHeader = async (job) => {
    // Enable Header toggle in frontend means run_headless becomes False
    const freshHeadless = !job.run_headless;
    try {
      const res = await fetch(`${API_BASE}/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_headless: freshHeadless })
      });
      if (res.ok) {
        showFeedback('success', `Browser window ${freshHeadless ? 'disabled' : 'enabled (Header mode)'} for ${job.name}.`);
        fetchJobs();
      }
    } catch (err) {
      showFeedback('error', 'Server error.');
    }
  };

  const handleCreateJob = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newJob)
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', `Job ${newJob.name} created successfully!`);
        setShowAddJobModal(false);
        setNewJob({
          name: '',
          script_filename: '',
          search_url: '',
          max_pages: 3,
          schedule_time: '01:00',
          enabled: false,
          run_headless: true
        });
        fetchJobs();
      } else {
        showFeedback('error', data.detail || 'Failed to create job.');
      }
    } catch (err) {
      showFeedback('error', 'API failure.');
    }
  };

  const handleUpdateJob = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/jobs/${editJobForm.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editJobForm)
      });
      if (res.ok) {
        showFeedback('success', `Job details updated.`);
        setShowEditJobModal(false);
        fetchJobs();
      } else {
        const data = await res.json();
        showFeedback('error', data.detail || 'Failed to update job.');
      }
    } catch (err) {
      showFeedback('error', 'API failure.');
    }
  };

  const handleDeleteJob = async (jobId) => {
    if (!confirm('Are you sure you want to delete this custom scraping job?')) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' });
      if (res.ok) {
        showFeedback('success', 'Custom job deleted successfully.');
        fetchJobs();
      } else {
        const data = await res.json();
        showFeedback('error', data.detail || 'Could not delete job.');
      }
    } catch (err) {
      showFeedback('error', 'API failure.');
    }
  };

  // Script File Uploader
  const handleScriptUpload = async (e) => {
    e.preventDefault();
    const fileInput = e.target.elements.script_file;
    if (!fileInput.files[0]) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
      const res = await fetch(`${API_BASE}/jobs/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', `Script ${data.filename} uploaded! You can now map it to a job.`);
        setUploadedFilename(data.filename);
        setNewJob(prev => ({ ...prev, script_filename: data.filename }));
        setShowUploadModal(false);
        setShowAddJobModal(true);
      } else {
        showFeedback('error', data.detail || 'Upload failed.');
      }
    } catch (err) {
      showFeedback('error', 'Server error during upload.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Background radial effects */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/2 right-1/4 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Header Container */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-indigo-500 to-purple-600 p-2.5 rounded-xl shadow-lg shadow-indigo-500/20">
              <Server className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">CronScrape Panel</h1>
              <p className="text-xs text-slate-400">Scraping Scheduler & Postgres Auto-Sync</p>
            </div>
          </div>

          {/* Feedback Toast */}
          {feedbackMsg.text && (
            <div className={`px-4 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 shadow-lg animate-bounce ${
              feedbackMsg.type === 'success' 
                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300' 
                : 'bg-rose-950/80 border-rose-500 text-rose-300'
            }`}>
              {feedbackMsg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {feedbackMsg.text}
            </div>
          )}

          {/* Quick connection indicator */}
          <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-xs">
            <span className="text-slate-400">PostgreSQL Status:</span>
            {stats.postgres_status === 'connected' ? (
              <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Connected
              </span>
            ) : stats.postgres_status === 'failed' ? (
              <span className="flex items-center gap-1.5 text-rose-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                Failed
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Not Configured
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Layout Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 sm:px-6 lg:px-8 flex flex-col gap-6">
        
        {/* Navigation Tabs Bar */}
        <div className="flex overflow-x-auto space-x-2 bg-slate-900/40 p-1.5 border border-slate-800 rounded-xl scrollbar-none">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 shrink-0 ${
              activeTab === 'overview' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4" /> Overview Dashboard
          </button>
          
          <button
            onClick={() => setActiveTab('jobs')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 shrink-0 ${
              activeTab === 'jobs' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <FileCode className="w-4 h-4" /> Manage Scripts ({jobs.length})
          </button>

          <button
            onClick={() => setActiveTab('explorer')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 shrink-0 ${
              activeTab === 'explorer' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Database className="w-4 h-4" /> Data Explorer
          </button>

          <button
            onClick={() => setActiveTab('postgres')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 shrink-0 ${
              activeTab === 'postgres' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4" /> Database Config
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 shrink-0 ${
              activeTab === 'logs' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Terminal className="w-4 h-4" /> Live Terminal {isLogsActive && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-1" />}
          </button>
        </div>

        {/* --- OVERVIEW TAB --- */}
        {activeTab === 'overview' && (
          <div className="flex flex-col gap-6">
            
            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center gap-4">
                <div className="bg-slate-950 text-indigo-400 p-3 rounded-xl border border-slate-800">
                  <Database className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-slate-400 text-xs uppercase font-semibold">Postgres DB</h3>
                  <p className="text-lg font-bold text-white mt-0.5 truncate">
                    {stats.postgres_status === 'connected' ? 'Connected' : 'Not Configured'}
                  </p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center gap-4">
                <div className="bg-slate-950 text-purple-400 p-3 rounded-xl border border-slate-800">
                  <FileCode className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-slate-400 text-xs uppercase font-semibold">Total Scrapers</h3>
                  <p className="text-3xl font-extrabold text-white mt-0.5">{stats.total_jobs}</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center gap-4">
                <div className="bg-slate-950 text-emerald-400 p-3 rounded-xl border border-slate-800">
                  <Play className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-slate-400 text-xs uppercase font-semibold">Running Now</h3>
                  <p className="text-3xl font-extrabold text-white mt-0.5">{stats.active_jobs}</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center gap-4">
                <div className="bg-slate-950 text-amber-400 p-3 rounded-xl border border-slate-800">
                  <Server className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-slate-400 text-xs uppercase font-semibold">Scraped Products</h3>
                  <p className="text-3xl font-extrabold text-white mt-0.5">{stats.total_products_scraped}</p>
                </div>
              </div>
            </div>

            {/* Pending sync queue fallback */}
            {pendingSyncs.length > 0 && (
              <div className="bg-slate-900 border border-amber-500/20 rounded-2xl p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-400">
                    <AlertTriangle className="w-5 h-5 animate-pulse" />
                    <h2 className="text-xs font-bold text-white uppercase tracking-wider">Pending Database Sync Queue ({pendingSyncs.length})</h2>
                  </div>
                  <button 
                    onClick={fetchPendingSyncs}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-semibold transition"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>
                
                <p className="text-xs text-slate-400 leading-relaxed">
                  The following scraper runs succeeded, but the database connection timed out or permissions were rejected. 
                  Update your database settings inside the <strong>Database Config</strong> tab, then click <strong>Retry Sync</strong>.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                  {pendingSyncs.map(sync => (
                    <div key={sync.id} className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-col justify-between gap-3 relative">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm text-white">{sync.job_name}</span>
                          <span className="text-[10px] bg-amber-950 border border-amber-500/50 text-amber-300 px-2 py-0.5 rounded-full font-bold">
                            {sync.product_count} products
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono mt-1">
                          Run: {sync.run_id.slice(0, 8)}... | {new Date(sync.scraped_at).toLocaleString()}
                        </p>
                        
                        <div className="mt-2.5 bg-slate-900/60 p-2.5 rounded border border-rose-950/60 text-[10px] text-rose-300 font-mono break-all whitespace-pre-wrap max-h-20 overflow-y-auto leading-relaxed">
                          Error: {sync.error_message || 'Unknown network connection failure.'}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 border-t border-slate-900 pt-2.5 mt-1">
                        <button
                          onClick={() => discardPendingSync(sync.id)}
                          disabled={isRetryingSyncId === sync.id}
                          className="text-[10px] text-rose-400 hover:text-rose-300 font-semibold px-2 py-1 hover:bg-rose-950/20 rounded transition"
                        >
                          Discard
                        </button>
                        <button
                          onClick={() => retryPendingSync(sync.id)}
                          disabled={isRetryingSyncId === sync.id}
                          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded text-[10px] flex items-center gap-1 transition"
                        >
                          {isRetryingSyncId === sync.id ? (
                            <>
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              Retrying...
                            </>
                          ) : (
                            'Retry Sync'
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Actions and Intro */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Introduction Card */}
              <div className="bg-gradient-to-tr from-slate-900 to-slate-950 border border-slate-800 p-6 rounded-2xl lg:col-span-2 flex flex-col justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-white mb-2">Automate Shopee & Tokopedia Scrapes</h2>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    This dynamic scraping engine lets you trigger and schedule scrapers natively on your Linux Zorin OS desktop. 
                    Running natively lets the scraper launch local headed Chromium browser windows to bypass anti-bot locks or let you login manually. 
                    Scraped data automatically pipelines to your hosted PostgreSQL database.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button 
                    onClick={() => setActiveTab('jobs')}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
                  >
                    View Scrapers
                  </button>
                  <button 
                    onClick={() => setActiveTab('postgres')}
                    className="bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-sm font-medium px-5 py-2.5 rounded-lg transition"
                  >
                    Setup database connection
                  </button>
                </div>
              </div>

              {/* Postgres configuration warning/info */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="w-5 h-5 text-indigo-400" />
                    <h3 className="font-bold text-white text-sm">PostgreSQL Output Pipeline</h3>
                  </div>
                  {stats.postgres_status === 'connected' ? (
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-emerald-400 font-semibold mb-1">✓ Connection Online</p>
                      Your database pipeline is connected. Scrapers will automatically populate table <code className="bg-slate-950 px-1 py-0.5 rounded text-amber-300">scraped_products</code> inside host <code className="text-slate-300">{postgresConfig.host}</code>.
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 leading-relaxed">
                      <p className="text-amber-400 font-semibold mb-1">⚠ Pipeline Disconnected</p>
                      Products will only be scraped but cannot be stored in the Postgres database yet. Open Settings and enter valid credentials to connect.
                    </div>
                  )}
                </div>
                {stats.postgres_status !== 'connected' && (
                  <button
                    onClick={() => setActiveTab('postgres')}
                    className="mt-4 w-full bg-slate-950 border border-slate-800 text-indigo-400 text-xs font-semibold py-2 rounded-lg hover:bg-slate-900 transition"
                  >
                    Setup Credentials
                  </button>
                )}
              </div>

            </div>

            {/* Quick jobs running status list */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h2 className="text-md font-bold text-white mb-4">Current Scrapers Status</h2>
              <div className="divide-y divide-slate-800">
                {jobs.map(job => (
                  <div key={job.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className={`w-3 h-3 rounded-full ${
                        job.status === 'running' 
                          ? 'bg-emerald-400 animate-pulse' 
                          : job.status === 'failed' 
                            ? 'bg-rose-500' 
                            : 'bg-slate-600'
                      }`} />
                      <div>
                        <h4 className="font-semibold text-white text-sm">{job.name}</h4>
                        <p className="text-xs text-slate-400">{job.script_filename} | Search: "{job.search_url.split('q=')[1] || job.search_url.split('keyword=')[1] || 'default'}"</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      {job.schedule_time ? (
                        <div className="text-slate-400">
                          Schedule: <span className="font-medium text-slate-200">{job.schedule_time} daily</span>
                        </div>
                      ) : (
                        <span className="text-slate-500">Manual triggers only</span>
                      )}
                      
                      <button
                        onClick={() => {
                          setSelectedJobLogs(job.id);
                          setActiveTab('logs');
                        }}
                        className="text-indigo-400 hover:text-indigo-300 font-semibold"
                      >
                        View Logs
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* --- MANAGE SCRIPTS TAB --- */}
        {activeTab === 'jobs' && (
          <div className="flex flex-col gap-6">
            
            {/* Header controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl">
              <div>
                <h2 className="text-lg font-bold text-white">Scraper Scripts & Cron Schedules</h2>
                <p className="text-xs text-slate-400">Run immediate browser-assisted scrapings, trigger cookie login configurations, and schedule cron timing parameters.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="bg-slate-950 border border-slate-800 text-indigo-400 hover:bg-slate-900 text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4 h-4" /> Upload Script
                </button>
                <button
                  onClick={() => {
                    setNewJob({
                      name: '',
                      script_filename: '',
                      search_url: '',
                      max_pages: 3,
                      schedule_time: '01:00',
                      enabled: false,
                      run_headless: true
                    });
                    setUploadedFilename('');
                    setShowAddJobModal(true);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4 h-4" /> Create Custom Job
                </button>
              </div>
            </div>

            {/* Jobs list grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {jobs.map(job => (
                <div key={job.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-5 relative overflow-hidden">
                  
                  {/* Status ribbon */}
                  {job.status === 'running' && (
                    <div className="absolute top-0 right-0 bg-emerald-500 text-slate-950 text-[10px] uppercase font-bold px-3 py-1 rounded-bl-lg animate-pulse">
                      Running
                    </div>
                  )}

                  <div>
                    {/* Header line */}
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-md font-bold text-white flex items-center gap-2">
                          {job.name}
                          {job.script_filename === 'shopee.py' && <span className="bg-indigo-950 border border-indigo-500 text-indigo-300 text-[10px] px-2 py-0.5 rounded-full">Shopee</span>}
                          {job.script_filename === 'tokopedia.py' && <span className="bg-purple-950 border border-purple-500 text-purple-300 text-[10px] px-2 py-0.5 rounded-full">Tokopedia</span>}
                        </h3>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">File: {job.script_filename}</p>
                      </div>
                      
                      {/* Configuration controls */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditJobForm(job);
                            setShowEditJobModal(true);
                          }}
                          className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
                          title="Edit Job details"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {job.script_filename !== 'shopee.py' && job.script_filename !== 'tokopedia.py' && (
                          <button
                            onClick={() => handleDeleteJob(job.id)}
                            className="p-2 hover:bg-slate-800 rounded-lg text-rose-400 hover:text-rose-300 transition"
                            title="Delete Job"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Specifications grid */}
                    <div className="mt-4 grid grid-cols-2 gap-4 text-xs border-y border-slate-800 py-3 my-3">
                      <div>
                        <span className="text-slate-500">Search Query / URL:</span>
                        <p className="text-slate-300 truncate font-mono mt-0.5" title={job.search_url}>
                          {job.search_url}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Max Pages:</span>
                        <p className="text-slate-300 font-semibold mt-0.5">{job.max_pages}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Daily Schedule:</span>
                        <p className="text-slate-300 font-semibold mt-0.5">
                          {job.schedule_time ? `${job.schedule_time}` : 'Disabled'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Next Scheduled Run:</span>
                        <p className="text-slate-300 mt-0.5 truncate font-semibold">
                          {job.enabled && job.next_run ? new Date(job.next_run).toLocaleString() : 'N/A'}
                        </p>
                      </div>
                    </div>

                    {/* Enable Header feature check (show selenium browser) */}
                    <div className="flex items-center justify-between bg-slate-950 p-2.5 border border-slate-800 rounded-lg text-xs">
                      <div>
                        <span className="text-white font-semibold flex items-center gap-1.5">
                          Enable Browser Window (Header mode)
                        </span>
                        <p className="text-slate-500 text-[10px]">Turn on to see chrome selenium browser action live on your screen</p>
                      </div>
                      <button
                        onClick={() => toggleJobHeader(job)}
                        className={`w-11 h-6 rounded-full p-1 transition-all duration-200 ${
                          !job.run_headless ? 'bg-indigo-600' : 'bg-slate-800'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white transition-all duration-200 ${
                          !job.run_headless ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </button>
                    </div>
                  </div>

                  {/* Actions line */}
                  <div className="flex items-center justify-between gap-3 mt-2 flex-wrap pt-3 border-t border-slate-800">
                    
                    {/* Schedule Active switcher */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleJobEnabled(job)}
                        className={`w-10 h-5.5 rounded-full p-1 transition-all duration-200 ${
                          job.enabled ? 'bg-indigo-600' : 'bg-slate-800'
                        }`}
                      >
                        <div className={`w-3.5 h-3.5 rounded-full bg-white transition-all duration-200 ${
                          job.enabled ? 'translate-x-4.5' : 'translate-x-0'
                        }`} />
                      </button>
                      <span className="text-xs text-slate-400 font-medium">Cron Schedule</span>
                    </div>

                    {/* Trigger controls */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => loginJob(job.id)}
                        disabled={job.status === 'running'}
                        className="bg-slate-950 hover:bg-slate-900 border border-slate-800 disabled:opacity-50 text-slate-300 font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 transition"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Login Setup
                      </button>
                      <button
                        onClick={() => runJobNow(job.id)}
                        disabled={job.status === 'running'}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-3.5 py-1.5 rounded-lg text-xs flex items-center gap-1 transition"
                      >
                        <Play className="w-3.5 h-3.5" /> Run Now
                      </button>
                    </div>
                  </div>

                </div>
              ))}
            </div>

          </div>
        )}

        {/* --- DATA EXPLORER TAB --- */}
        {activeTab === 'explorer' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            
            {/* Header filters */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Scraped Products Database</h2>
                <p className="text-xs text-slate-400">View scraped items stored inside PostgreSQL database.</p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <input
                    type="text"
                    placeholder="Search product..."
                    value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchProducts()}
                    className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 w-full sm:w-60"
                  />
                </div>
                
                <select
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">All Marketplaces</option>
                  <option value="shopee">Shopee</option>
                  <option value="tokopedia">Tokopedia</option>
                </select>

                <button
                  onClick={fetchProducts}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition shrink-0"
                >
                  Apply Filters
                </button>
              </div>
            </div>

            {/* Products Listing */}
            {products.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-sm">
                <Database className="w-12 h-12 mx-auto text-slate-600 mb-3" />
                No products found in PostgreSQL database. 
                Configure your database settings and run a scraper to populate it.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                
                {/* Table for Desktop */}
                <div className="overflow-x-auto hidden md:block border border-slate-800 rounded-xl bg-slate-950/40">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/80">
                        <th className="p-3.5">Product Name</th>
                        <th className="p-3.5">Marketplace</th>
                        <th className="p-3.5">Price</th>
                        <th className="p-3.5">Discount Price</th>
                        <th className="p-3.5">Discount %</th>
                        <th className="p-3.5">Rating</th>
                        <th className="p-3.5">Sold</th>
                        <th className="p-3.5">Location</th>
                        <th className="p-3.5">Store Type</th>
                        <th className="p-3.5">Scraped At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {products.map(p => (
                        <tr key={p.id} className="hover:bg-slate-900/50 text-slate-300">
                          <td className="p-3 font-semibold text-white max-w-[200px] truncate" title={p.product_name}>{p.product_name}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                              p.source === 'shopee' 
                                ? 'bg-indigo-950 border-indigo-500 text-indigo-300' 
                                : 'bg-purple-950 border-purple-500 text-purple-300'
                            }`}>
                              {p.source}
                            </span>
                          </td>
                          <td className="p-3 font-mono">{p.original_price || 'N/A'}</td>
                          <td className="p-3 font-mono text-emerald-400">{p.discount_price || '-'}</td>
                          <td className="p-3 text-emerald-400">{p.discount_percentage || '-'}</td>
                          <td className="p-3">⭐ {p.rating || 'N/A'}</td>
                          <td className="p-3">{p.sold_count || 'N/A'}</td>
                          <td className="p-3 truncate max-w-[120px]">{p.store_location || 'N/A'}</td>
                          <td className="p-3">{p.store_type || 'Regular'}</td>
                          <td className="p-3 text-slate-400 font-mono">{new Date(p.scraped_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Cards for Mobile (Android) */}
                <div className="grid grid-cols-1 gap-4 md:hidden">
                  {products.map(p => (
                    <div key={p.id} className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                          p.source === 'shopee' 
                            ? 'bg-indigo-950 border-indigo-500 text-indigo-300' 
                            : 'bg-purple-950 border-purple-500 text-purple-300'
                        }`}>
                          {p.source}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">{new Date(p.scraped_at).toLocaleDateString()}</span>
                      </div>
                      <h4 className="font-bold text-white text-sm line-clamp-2">{p.product_name}</h4>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-800 pt-2.5 mt-1">
                        <div>
                          <span className="text-slate-500 block text-[10px]">Price:</span>
                          <span className="font-mono text-slate-300">{p.original_price || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Promo:</span>
                          <span className="font-mono text-emerald-400">{p.discount_price || '-'} ({p.discount_percentage || '-'})</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Rating:</span>
                          <span className="text-slate-300">⭐ {p.rating || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Sold:</span>
                          <span className="text-slate-300">{p.sold_count || 'N/A'}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-slate-500 block text-[10px]">Location:</span>
                          <span className="text-slate-300 text-xs truncate block">{p.store_location || 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination Controls */}
                <div className="flex items-center justify-between border-t border-slate-800 pt-4 mt-2">
                  <span className="text-xs text-slate-400">
                    Showing <span className="font-semibold text-slate-200">{products.length}</span> of <span className="font-semibold text-slate-200">{productsCount}</span> products
                  </span>
                  
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="p-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-400 disabled:opacity-30 hover:bg-slate-850 hover:text-white transition"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="px-3 py-1 bg-slate-950 border border-slate-800 text-xs font-semibold rounded-lg text-white">
                      Page {currentPage} of {Math.ceil(productsCount / itemsPerPage) || 1}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(Math.ceil(productsCount / itemsPerPage), prev + 1))}
                      disabled={currentPage >= Math.ceil(productsCount / itemsPerPage)}
                      className="p-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-400 disabled:opacity-30 hover:bg-slate-850 hover:text-white transition"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

              </div>
            )}

          </div>
        )}

        {/* --- DATABASE CONFIG TAB --- */}
        {activeTab === 'postgres' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Config Form card */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl lg:col-span-2 flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">PostgreSQL Configuration</h2>
                <p className="text-xs text-slate-400">Define the database server connections. Scraped product data is dynamically inserted here.</p>
              </div>

              <form className="flex flex-col gap-4" onSubmit={savePostgresConfig}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2 flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold">Host:</label>
                    <input
                      type="text"
                      required
                      value={postgresConfig.host}
                      onChange={(e) => setPostgresConfig({...postgresConfig, host: e.target.value})}
                      placeholder="e.g. 192.168.1.10 or localhost"
                      className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold">Port:</label>
                    <input
                      type="number"
                      required
                      value={postgresConfig.port}
                      onChange={(e) => setPostgresConfig({...postgresConfig, port: parseInt(e.target.value) || 5432})}
                      placeholder="5432"
                      className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">Database Name:</label>
                  <input
                    type="text"
                    required
                    value={postgresConfig.database}
                    onChange={(e) => setPostgresConfig({...postgresConfig, database: e.target.value})}
                    placeholder="scraper_db"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold">Username:</label>
                    <input
                      type="text"
                      required
                      value={postgresConfig.user}
                      onChange={(e) => setPostgresConfig({...postgresConfig, user: e.target.value})}
                      placeholder="postgres"
                      className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold">Password:</label>
                    <input
                      type="password"
                      value={postgresConfig.password}
                      onChange={(e) => setPostgresConfig({...postgresConfig, password: e.target.value})}
                      placeholder="••••••••"
                      className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-4 border-t border-slate-800 pt-4">
                  <button
                    type="button"
                    onClick={testPostgresConfig}
                    className="bg-slate-950 border border-slate-800 text-indigo-400 hover:bg-slate-900 text-sm font-semibold px-5 py-2.5 rounded-xl transition"
                  >
                    Test Connection
                  </button>
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition"
                  >
                    Save Config
                  </button>
                </div>
              </form>
            </div>

            {/* Instruction sidebar */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex flex-col gap-4">
              <div className="flex items-center gap-2 text-indigo-400 border-b border-slate-800 pb-3">
                <Database className="w-5 h-5" />
                <h3 className="font-bold text-white text-sm">Postgres Setup Guide</h3>
              </div>
              <div className="text-xs text-slate-400 flex flex-col gap-3">
                <p>
                  Ensure your remote PostgreSQL server allows client TCP/IP connections from this desktop. 
                  You may need to modify your PostgreSQL's configuration files:
                </p>
                <div className="bg-slate-950 p-2.5 border border-slate-850 rounded-lg font-mono leading-relaxed">
                  # postgresql.conf<br />
                  listen_addresses = '*'<br /><br />
                  # pg_hba.conf<br />
                  host all all 0.0.0.0/0 md5
                </div>
                <p className="mt-2 text-slate-500">
                  We will automatically verify and execute necessary migration tables when you hit "Save Config".
                </p>
              </div>
            </div>

          </div>
        )}

        {/* --- LOGS TERMINAL TAB --- */}
        {activeTab === 'logs' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-4">
            
            {/* Header select */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-md font-bold text-white flex items-center gap-2">
                  Live Scraping Logs
                  {isLogsActive && <span className="bg-emerald-950 border border-emerald-500 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active Run
                  </span>}
                </h2>
                <p className="text-xs text-slate-400">Monitor subprocess print output execution records live.</p>
              </div>
              
              <div className="flex items-center gap-3">
                <select
                  value={selectedJobLogs || ''}
                  onChange={(e) => setSelectedJobLogs(parseInt(e.target.value) || null)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Select Scraper...</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>{j.name} ({j.script_filename})</option>
                  ))}
                </select>
                
                {selectedJobLogs && (
                  <button
                    onClick={() => fetchLogs(selectedJobLogs)}
                    className="p-2.5 bg-slate-950 border border-slate-800 text-indigo-400 hover:text-white rounded-xl transition"
                    title="Force reload logs"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLogsActive ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
            </div>

            {/* Monospace terminal console */}
            <div className="bg-slate-950 border border-slate-850 rounded-2xl p-5 font-mono text-xs text-slate-300 min-h-[400px] max-h-[550px] overflow-y-auto flex flex-col gap-1 shadow-inner relative">
              {logs.length === 0 ? (
                <div className="text-slate-500 text-center py-24 flex flex-col gap-2">
                  <Terminal className="w-10 h-10 mx-auto text-slate-700" />
                  Select a scraper script to view its live or latest execution logs.
                </div>
              ) : (
                <>
                  {logs.map((line, idx) => (
                    <div key={idx} className="leading-relaxed hover:bg-slate-900/30 py-0.5 rounded px-1 break-all">
                      {line}
                    </div>
                  ))}
                  <div ref={terminalEndRef} />
                </>
              )}
            </div>

          </div>
        )}

      </main>

      {/* --- ADD JOB MODAL --- */}
      {showAddJobModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4 shadow-xl">
            <div>
              <h3 className="text-lg font-bold text-white">Create Scraping Job</h3>
              <p className="text-xs text-slate-400">Map a local script file to run queries under specific daily timing triggers.</p>
            </div>

            <form onSubmit={handleCreateJob} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">Job Name:</label>
                <input
                  type="text"
                  required
                  value={newJob.name}
                  onChange={(e) => setNewJob({...newJob, name: e.target.value})}
                  placeholder="e.g. Shopee RTX Graphics"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">Script Python Filename:</label>
                <input
                  type="text"
                  required
                  value={newJob.script_filename}
                  onChange={(e) => setNewJob({...newJob, script_filename: e.target.value})}
                  placeholder="e.g. custom_scraper.py"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
                />
                <p className="text-[10px] text-slate-500">Ensure the file exists inside backend/scripts directory.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">Target Search URL:</label>
                <textarea
                  required
                  value={newJob.search_url}
                  onChange={(e) => setNewJob({...newJob, search_url: e.target.value})}
                  placeholder="https://shopee.co.id/search?keyword=..."
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 min-h-[60px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">Max Pages:</label>
                  <input
                    type="number"
                    required
                    value={newJob.max_pages}
                    onChange={(e) => setNewJob({...newJob, max_pages: parseInt(e.target.value) || 3})}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">Schedule Daily Time (HH:MM):</label>
                  <input
                    type="text"
                    required
                    value={newJob.schedule_time}
                    onChange={(e) => setNewJob({...newJob, schedule_time: e.target.value})}
                    placeholder="01:00 or 01:00-03:00"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">E.g., 01:30 (fixed) or 01:00-03:00 (random daily range).</p>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-4 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddJobModal(false)}
                  className="bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-900 text-sm font-semibold px-5 py-2.5 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- EDIT JOB MODAL --- */}
      {showEditJobModal && editJobForm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4 shadow-xl">
            <div>
              <h3 className="text-lg font-bold text-white">Edit Job Parameters</h3>
              <p className="text-xs text-slate-400">Modify targets, schedule, page scanning counts, and browser settings for {editJobForm.name}.</p>
            </div>

            <form onSubmit={handleUpdateJob} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">Job Name:</label>
                <input
                  type="text"
                  required
                  value={editJobForm.name}
                  onChange={(e) => setEditJobForm({...editJobForm, name: e.target.value})}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">Target Search URL:</label>
                <textarea
                  required
                  value={editJobForm.search_url}
                  onChange={(e) => setEditJobForm({...editJobForm, search_url: e.target.value})}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 min-h-[60px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">Max Pages:</label>
                  <input
                    type="number"
                    required
                    value={editJobForm.max_pages}
                    onChange={(e) => setEditJobForm({...editJobForm, max_pages: parseInt(e.target.value) || 3})}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">Daily Time (HH:MM):</label>
                  <input
                    type="text"
                    required
                    value={editJobForm.schedule_time}
                    onChange={(e) => setEditJobForm({...editJobForm, schedule_time: e.target.value})}
                    placeholder="01:00 or 01:00-03:00"
                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">E.g., 01:30 (fixed) or 01:00-03:00 (random daily range).</p>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-4 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditJobModal(false)}
                  className="bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-900 text-sm font-semibold px-5 py-2.5 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- UPLOAD SCRIPT MODAL --- */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full flex flex-col gap-4 shadow-xl">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-indigo-400" />
                Upload Python Scraper Script
              </h3>
              <p className="text-xs text-slate-400">Select a script conforming to our scraping rule contract to store in your host desktop.</p>
            </div>

            <form onSubmit={handleScriptUpload} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2.5 border-2 border-dashed border-slate-800 hover:border-slate-700 bg-slate-950/50 p-6 rounded-xl text-center cursor-pointer transition">
                <input
                  type="file"
                  name="script_file"
                  accept=".py"
                  required
                  className="text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-900 file:text-indigo-400 file:cursor-pointer hover:file:bg-slate-800 cursor-pointer"
                />
              </div>

              <div className="bg-slate-950 p-3 rounded-lg text-[10px] text-slate-500 flex flex-col gap-1 border border-slate-850">
                <span className="font-semibold text-slate-400">Uploading Scraper script rules:</span>
                <span>• Script file must be a standard python file ending with <code className="text-amber-300">.py</code>.</span>
                <span>• Script must accept CLI flags: <code className="text-indigo-300">--url</code>, <code className="text-indigo-300">--pages</code>, and <code className="text-indigo-300">--output</code>.</span>
                <span>• Script output must format product lists into JSON stored inside the file specified by <code className="text-indigo-300">--output</code> on successful completion.</span>
              </div>

              <div className="flex justify-end gap-3 mt-2 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-900 text-sm font-semibold px-5 py-2.5 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition"
                >
                  Upload File
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 bg-slate-950/80 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4">
          <p>© 2026 CronScrape Panel. Designed for native desktop automation on Linux Zorin OS PC.</p>
        </div>
      </footer>
    </div>
  );
}
