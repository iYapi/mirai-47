import React, { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
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
  ChevronRight,
  ChevronUp,
  ChevronDown,
  TrendingUp
} from 'lucide-react';

const API_BASE = 'http://localhost:8000/api';

const renderPriceChangeBadge = (change) => {
  if (!change || change === 0) return null;
  const isDrop = change < 0;
  const absValue = Math.abs(change);
  const formattedVal = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(absValue);
  
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase border font-sans select-none ${
      isDrop 
        ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-400' 
        : 'bg-rose-950/60 border-rose-500/30 text-rose-400'
    }`}>
      {isDrop ? '↓' : '↑'} {formattedVal}
    </span>
  );
};

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
  const [sortBy, setSortBy] = useState('scraped_at');
  const [sortOrder, setSortOrder] = useState('desc');

  // Pending Sync state
  const [pendingSyncs, setPendingSyncs] = useState([]);
  const [isRetryingSyncId, setIsRetryingSyncId] = useState(null);

  // Modals & Forms
  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const [showEditJobModal, setShowEditJobModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [uploadedFilename, setUploadedFilename] = useState('');
  const [scripts, setScripts] = useState([]);
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  
  const [newJob, setNewJob] = useState({
    name: '',
    script_filename: '',
    search_url: '',
    max_pages: 3,
    schedule_time: '01:00',
    enabled: false,
    continuous: false,
    run_headless: true
  });

  const [editJobForm, setEditJobForm] = useState(null);
  const [chainActive, setChainActive] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [countdownJobName, setCountdownJobName] = useState('');
  const [priceHistoryProduct, setPriceHistoryProduct] = useState(null);
  const [priceHistoryData, setPriceHistoryData] = useState([]);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
  const [bulkJobForm, setBulkJobForm] = useState({
    script_filename: '',
    urls_input: '',
    max_pages: 3,
    schedule_time: '01:00',
    enabled: false,
    continuous: false,
    run_headless: true
  });

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
    fetchScripts();
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

  // Countdown timer for next scheduled delay run
  useEffect(() => {
    // Find the next scheduled continuous job
    const activeJobs = jobs.filter(j => j.continuous && j.enabled && j.next_run);
    const nextJ = activeJobs.find(j => new Date(j.next_run) > new Date());
    
    if (nextJ && chainActive) {
      setCountdownJobName(nextJ.name);
      const updateCountdown = () => {
        const diff = Math.max(0, Math.floor((new Date(nextJ.next_run) - new Date()) / 1000));
        setSecondsLeft(diff);
      };
      updateCountdown();
      const interval = setInterval(updateCountdown, 1000);
      return () => clearInterval(interval);
    } else {
      setSecondsLeft(0);
      setCountdownJobName('');
    }
  }, [jobs, chainActive]);

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

  // Load Products when tab, filters or sorting change
  useEffect(() => {
    if (activeTab === 'explorer') {
      fetchProducts();
    }
  }, [activeTab, filterSource, currentPage, sortBy, sortOrder]);

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

  const fetchChainStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/chain/status`);
      if (res.ok) {
        const data = await res.json();
        setChainActive(data.chain_active);
      }
    } catch (err) {
      console.error('Error fetching chain status:', err);
    }
  };

  const handleStopChain = async () => {
    try {
      const res = await fetch(`${API_BASE}/chain/stop`, { method: 'POST' });
      if (res.ok) {
        showFeedback('success', 'Execution chain interrupted and stopped.');
        fetchJobs();
      } else {
        showFeedback('error', 'Failed to stop execution chain.');
      }
    } catch (err) {
      showFeedback('error', 'API failure.');
    }
  };

  const handleViewPriceHistory = async (product) => {
    setPriceHistoryProduct(product);
    setPriceHistoryLoading(true);
    setPriceHistoryData([]);
    try {
      const urlParam = encodeURIComponent(product.url || '');
      const nameParam = encodeURIComponent(product.product_name || '');
      const res = await fetch(`${API_BASE}/products/price-history?url=${urlParam}&product_name=${nameParam}`);
      if (res.ok) {
        const data = await res.json();
        setPriceHistoryData(data);
      } else {
        showFeedback('error', 'Failed to retrieve price history.');
      }
    } catch (err) {
      showFeedback('error', 'Failed to connect to API.');
    } finally {
      setPriceHistoryLoading(false);
    }
  };

  const handleSkipChain = async () => {
    try {
      const res = await fetch(`${API_BASE}/chain/skip`, { method: 'POST' });
      if (res.ok) {
        showFeedback('success', 'Skipped current scraper job successfully.');
        fetchJobs();
      } else {
        const data = await res.json();
        showFeedback('error', data.detail || 'Failed to skip scraper job.');
      }
    } catch (err) {
      showFeedback('error', 'API skip failure.');
    }
  };

  const handleSkipDelay = async () => {
    try {
      const res = await fetch(`${API_BASE}/chain/skip-delay`, { method: 'POST' });
      if (res.ok) {
        showFeedback('success', 'Skipped delay. Starting next scraper immediately.');
        fetchJobs();
      } else {
        const data = await res.json();
        showFeedback('error', data.detail || 'Failed to skip delay.');
      }
    } catch (err) {
      showFeedback('error', 'API skip delay failure.');
    }
  };

  const handleReorderJob = async (index, direction) => {
    const activeJobs = jobs.filter(j => j.continuous && j.enabled);
    if (activeJobs.length <= 1) return;
    
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= activeJobs.length) return;
    
    // Swap items in local array
    const newActiveJobs = [...activeJobs];
    const temp = newActiveJobs[index];
    newActiveJobs[index] = newActiveJobs[targetIndex];
    newActiveJobs[targetIndex] = temp;
    
    // Gather all IDs maintaining relative index configurations
    const activeIds = newActiveJobs.map(j => j.id);
    const otherIds = jobs.filter(j => !(j.continuous && j.enabled)).map(j => j.id);
    const finalIds = [...activeIds, ...otherIds];
    
    try {
      const res = await fetch(`${API_BASE}/jobs/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: finalIds })
      });
      if (res.ok) {
        showFeedback('success', 'Execution queue reordered successfully!');
        fetchJobs();
      } else {
        showFeedback('error', 'Failed to reorder execution queue.');
      }
    } catch (err) {
      showFeedback('error', 'API reorder failure.');
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`);
      const data = await res.json();
      setJobs(data);
      fetchChainStatus();
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  };

  const fetchScripts = async () => {
    try {
      const res = await fetch(`${API_BASE}/scripts`);
      const data = await res.json();
      setScripts(data || []);
      if (data && data.length > 0) {
        setNewJob(prev => prev.script_filename ? prev : { ...prev, script_filename: data[0] });
      }
    } catch (err) {
      console.error('Error fetching scripts:', err);
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
    
    const query = `
      query GetProducts(
        $limit: Int!
        $offset: Int!
        $source: String
        $search: String
        $sortBy: String!
        $sortOrder: String!
      ) {
        get_products(
          limit: $limit
          offset: $offset
          source: $source
          search: $search
          sort_by: $sortBy
          sort_order: $sortOrder
        ) {
          status
          total
          products {
            id
            url
            timestamp
            product_name
            original_price
            original_price_cleaned
            discount_price
            discount_price_cleaned
            discount_percentage
            rating
            rating_cleaned
            sold_count
            sold_count_cleaned
            store_name
            store_location
            store_type
            source
            page
            query_keyword
            job_name
            scraped_at
          }
        }
      }
    `;

    const variables = {
      limit: itemsPerPage,
      offset: offset,
      source: filterSource || null,
      search: filterSearch || null,
      sortBy: sortBy,
      sortOrder: sortOrder
    };

    try {
      const res = await fetch(`${API_BASE}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, variables })
      });
      const resData = await res.json();
      
      if (resData.errors) {
        console.error('GraphQL errors:', resData.errors);
        return;
      }
      
      const data = resData.data.get_products;
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
          continuous: false,
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

  const handleBulkEnable = async (enabled) => {
    try {
      const res = await fetch(`${API_BASE}/jobs/bulk/enable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedJobIds, enabled })
      });
      if (res.ok) {
        showFeedback('success', `Bulk updated selection.`);
        setSelectedJobIds([]);
        fetchJobs();
      } else {
        showFeedback('error', 'Failed bulk update.');
      }
    } catch (err) {
      showFeedback('error', 'API failure.');
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete the ${selectedJobIds.length} selected job(s)?`)) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/bulk/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedJobIds })
      });
      if (res.ok) {
        showFeedback('success', `Bulk deleted selection.`);
        setSelectedJobIds([]);
        fetchJobs();
      } else {
        showFeedback('error', 'Failed bulk delete.');
      }
    } catch (err) {
      showFeedback('error', 'API failure.');
    }
  };

  const handleBulkAddSubmit = async (e) => {
    e.preventDefault();
    const urls = bulkJobForm.urls_input.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    if (urls.length === 0) {
      showFeedback('error', 'Please enter at least one URL.');
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}/jobs/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script_filename: bulkJobForm.script_filename,
          urls: urls,
          max_pages: bulkJobForm.max_pages,
          schedule_time: bulkJobForm.continuous ? null : bulkJobForm.schedule_time,
          enabled: bulkJobForm.enabled,
          continuous: bulkJobForm.continuous,
          run_headless: bulkJobForm.run_headless
        })
      });
      if (res.ok) {
        showFeedback('success', `Successfully created ${urls.length} scraping jobs in bulk!`);
        setShowBulkAddModal(false);
        fetchJobs();
      } else {
        const data = await res.json();
        showFeedback('error', data.detail || 'Failed to bulk add jobs.');
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
        fetchScripts();
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
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
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
              <h1 className="text-xl font-bold tracking-tight text-white">Mirai-47</h1>
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
            onClick={() => setActiveTab('queue')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 shrink-0 ${
              activeTab === 'queue' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <RefreshCw className="w-4 h-4" /> Sequential Queue {chainActive && <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse ml-1" />}
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
                       Your database pipeline is connected. Scrapers will automatically populate table <code className="bg-slate-950 px-1 py-0.5 rounded text-amber-300">raw_scrapes</code> inside host <code className="text-slate-300">{postgresConfig.host}</code>.
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
                {chainActive && (
                  <button
                    onClick={handleStopChain}
                    className="bg-rose-950 border border-rose-500/40 text-rose-300 hover:bg-rose-900 text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition animate-pulse mr-2"
                    title="Stop/Interrupt current continuous chain sequence"
                  >
                    <XCircle className="w-4 h-4 text-rose-400" /> Interrupt Chain
                  </button>
                )}
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="bg-slate-950 border border-slate-800 text-indigo-400 hover:bg-slate-900 text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4 h-4" /> Upload Script
                </button>
                <button
                  onClick={() => {
                    setBulkJobForm({
                      script_filename: scripts[0] || '',
                      urls_input: '',
                      max_pages: 3,
                      schedule_time: '01:00',
                      enabled: false,
                      continuous: false,
                      run_headless: true
                    });
                    setShowBulkAddModal(true);
                  }}
                  className="bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-900 text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4 h-4" /> Bulk Add Jobs
                </button>
                <button
                  onClick={() => {
                    setNewJob({
                      name: '',
                      script_filename: scripts[0] || '',
                      search_url: '',
                      max_pages: 3,
                      schedule_time: '01:00',
                      enabled: false,
                      continuous: false,
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

            {/* Bulk Action Controls */}
            {selectedJobIds.length > 0 && (
              <div className="w-full bg-slate-900 border border-indigo-500/30 p-4 rounded-xl flex flex-wrap items-center justify-between gap-4 mb-6 shadow-lg shadow-indigo-500/5 animate-fade-in">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedJobIds.length === jobs.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedJobIds(jobs.map(j => j.id));
                      } else {
                        setSelectedJobIds([]);
                      }
                    }}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-800 bg-slate-950 cursor-pointer"
                  />
                  <span className="text-sm font-semibold text-slate-200">
                    {selectedJobIds.length} job{selectedJobIds.length > 1 ? 's' : ''} selected
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleBulkEnable(true)}
                    className="bg-indigo-950 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-900 text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                  >
                    Enable Selected
                  </button>
                  <button
                    onClick={() => handleBulkEnable(false)}
                    className="bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900 text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                  >
                    Disable Selected
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    className="bg-rose-950 border border-rose-500/40 text-rose-300 hover:bg-rose-900 text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                  >
                    Delete Selected
                  </button>
                  <button
                    onClick={() => setSelectedJobIds([])}
                    className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5 transition"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            )}

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
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedJobIds.includes(job.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedJobIds(prev => [...prev, job.id]);
                            } else {
                              setSelectedJobIds(prev => prev.filter(id => id !== job.id));
                            }
                          }}
                          className="w-4 h-4 mt-1.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-800 bg-slate-950 cursor-pointer"
                        />
                        <div>
                          <h3 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                            {job.name}
                            {job.script_filename === 'shopee.py' && <span className="bg-indigo-950 border border-indigo-500 text-indigo-300 text-[10px] px-2 py-0.5 rounded-full">Shopee</span>}
                            {job.script_filename === 'tokopedia.py' && <span className="bg-purple-950 border border-purple-500 text-purple-300 text-[10px] px-2 py-0.5 rounded-full">Tokopedia</span>}
                            {job.continuous && <span className="bg-emerald-950 border border-emerald-500 text-emerald-300 text-[10px] px-2 py-0.5 rounded-full">🔄 Continuous</span>}
                          </h3>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">File: {job.script_filename}</p>
                        </div>
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
                        <button
                          onClick={() => handleDeleteJob(job.id)}
                          className="p-2 hover:bg-slate-800 rounded-lg text-rose-400 hover:text-rose-300 transition"
                          title="Delete Job"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
                          {job.continuous ? '🔄 Continuous Scrape' : (job.schedule_time ? `${job.schedule_time}` : 'Disabled')}
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

        {/* --- SEQUENTIAL QUEUE TAB --- */}
        {activeTab === 'queue' && (
          <div className="flex flex-col gap-6">
            
            {/* Status Card Banner */}
            <div className={`border rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xl transition-all duration-300 ${
              chainActive 
                ? 'bg-rose-950/20 border-rose-500/30' 
                : 'bg-slate-900 border-slate-800'
            }`}>
              <div className="flex items-start gap-4">
                <div className={`p-3.5 rounded-xl shrink-0 ${
                  chainActive ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-950 text-slate-400'
                }`}>
                  <RefreshCw className={`w-6 h-6 ${chainActive ? 'animate-spin' : ''}`} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    Execution Chain Status: 
                    <span className={chainActive ? 'text-rose-400' : 'text-slate-400'}>
                      {chainActive ? 'Active & Processing' : 'Idle'}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-xl">
                    {chainActive 
                      ? secondsLeft > 0 
                        ? `⏰ Next scraper "${countdownJobName}" is scheduled to begin in ${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s.`
                        : 'The scraper sequence is active. Jobs are running one-by-one sequentially in the order defined below, with a random 0-3 minute human-like delay between each step.'
                      : 'The execution chain is currently paused. When triggered (either automatically by the daily schedule trigger or manually by clicking "Run Now"), the sequence will run all continuous jobs in order all the way to the end.'}
                  </p>
                </div>
              </div>
              
              {chainActive ? (
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  {secondsLeft > 0 && (
                    <button
                      onClick={handleSkipDelay}
                      className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white font-bold px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-amber-600/20 active:scale-95 cursor-pointer"
                      title="Skip the delay and execute the scraper immediately"
                    >
                      ⚡ Skip Delay
                    </button>
                  )}
                  <button
                    onClick={handleSkipChain}
                    className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer"
                    title="Skip current running or scheduled scraper job"
                  >
                    <ChevronRight className="w-5 h-5 text-indigo-400" /> Skip Current Job
                  </button>
                  <button
                    onClick={handleStopChain}
                    className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white font-semibold px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-rose-600/20 active:scale-95 cursor-pointer"
                  >
                    <XCircle className="w-5 h-5" /> Interrupt Chain Execution
                  </button>
                </div>
              ) : (
                <button
                  onClick={async () => {
                    const triggerJob = jobs.find(j => !j.continuous && j.enabled);
                    if (triggerJob) {
                      try {
                        await fetch(`${API_BASE}/jobs/${triggerJob.id}/run`, { method: 'POST' });
                        showFeedback('success', `Initiated scraper chain starting from trigger job ${triggerJob.name}.`);
                        fetchJobs();
                      } catch (err) {
                        showFeedback('error', 'Failed to trigger.');
                      }
                    } else {
                      const firstContinuous = jobs.find(j => j.continuous && j.enabled);
                      if (firstContinuous) {
                        try {
                          await fetch(`${API_BASE}/jobs/${firstContinuous.id}/run`, { method: 'POST' });
                          showFeedback('success', `Initiated scraper chain starting from ${firstContinuous.name}.`);
                          fetchJobs();
                        } catch (err) {
                          showFeedback('error', 'Failed to trigger.');
                        }
                      } else {
                        showFeedback('error', 'No enabled jobs found to start the execution chain.');
                      }
                    }
                  }}
                  className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-indigo-600/20 active:scale-95 cursor-pointer"
                >
                  <Play className="w-5 h-5" /> Bootstrap Chain Sequence
                </button>
              )}
            </div>

            {/* Split Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Trigger configuration (left panel) */}
              <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Server className="w-4 h-4 text-indigo-400" />
                    Daily Chain Trigger
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">The scheduled job that kicks off the sequential chain run daily.</p>
                </div>
                
                <div className="flex flex-col gap-3">
                  {jobs.filter(j => !j.continuous && j.enabled).length === 0 ? (
                    <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl text-center text-xs text-slate-500 border-dashed">
                      No daily trigger jobs are currently enabled. The chain must be bootstrapped manually.
                    </div>
                  ) : (
                    jobs.filter(j => !j.continuous && j.enabled).map(j => (
                      <div key={j.id} className="bg-slate-950 border border-slate-850 p-3.5 rounded-xl flex flex-col gap-2 relative">
                        <div className="flex justify-between items-start">
                          <span className="text-xs font-bold text-slate-200 truncate pr-24">{j.name}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={async () => {
                                try {
                                  await fetch(`${API_BASE}/jobs/${j.id}/run`, { method: 'POST' });
                                  showFeedback('success', `Initiated scraper chain starting from trigger job ${j.name}.`);
                                  fetchJobs();
                                } catch (err) {
                                  showFeedback('error', 'Failed to trigger.');
                                }
                              }}
                              className="p-1 rounded bg-slate-900 border border-slate-800 text-emerald-400 hover:text-emerald-300 hover:bg-slate-850 transition cursor-pointer"
                              title="Start Execution Chain"
                            >
                              <Play className="w-3 h-3 fill-current" />
                            </button>
                            {chainActive && (
                              <button
                                onClick={handleStopChain}
                                className="p-1 rounded bg-slate-900 border border-slate-800 text-rose-400 hover:text-rose-300 hover:bg-slate-850 transition cursor-pointer"
                                title="Stop Execution Chain"
                              >
                                <XCircle className="w-3 h-3" />
                              </button>
                            )}
                            <span className="bg-indigo-950 border border-indigo-500/30 text-indigo-300 text-[9px] font-mono px-2 py-0.5 rounded-md">
                              {j.schedule_time}
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono truncate">{j.search_url}</p>
                        <div className="flex justify-between items-center text-[10px] border-t border-slate-900 pt-2 mt-1">
                          <span className="text-slate-400 font-medium">Script: <code className="text-slate-300">{j.script_filename}</code></span>
                          <span className="text-slate-400">Next Boot: <strong className="text-slate-300 font-semibold">{j.next_run ? new Date(j.next_run).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'N/A'}</strong></span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Sequential Queue (right panel, 2 cols) */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <RefreshCw className="w-4 h-4 text-indigo-400" />
                      Continuous Sequence Chain
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">Sequence order of scraper links. Use arrows to change reorder position.</p>
                  </div>
                  <span className="bg-slate-950 border border-slate-800 px-3 py-1 rounded-lg text-xs font-semibold text-indigo-400 font-mono">
                    {jobs.filter(j => j.continuous && j.enabled).length} Active Links
                  </span>
                </div>

                <div className="flex flex-col gap-2.5">
                  {jobs.filter(j => j.continuous && j.enabled).length === 0 ? (
                    <div className="bg-slate-950 border border-slate-850 p-8 rounded-xl text-center text-xs text-slate-500 border-dashed">
                      No continuous jobs are currently enabled in the sequence chain. Mark jobs as continuous and enable them to populate this list.
                    </div>
                  ) : (
                    jobs.filter(j => j.continuous && j.enabled).map((j, index, arr) => {
                      const isNext = j.next_run && chainActive;
                      const isCurrent = j.status === 'running';
                      return (
                        <div 
                          key={j.id} 
                          className={`bg-slate-950 border p-3.5 rounded-xl flex items-center justify-between gap-4 transition-all duration-200 ${
                            isCurrent 
                              ? 'border-emerald-500/40 bg-emerald-950/5' 
                              : isNext 
                                ? 'border-indigo-500/40 bg-indigo-950/5' 
                                : 'border-slate-850'
                          }`}
                        >
                          <div className="flex items-center gap-3.5 min-w-0 flex-1">
                            {/* Sequence number */}
                            <span className={`w-6 h-6 rounded-lg text-xs font-bold font-mono flex items-center justify-center shrink-0 ${
                              isCurrent 
                                ? 'bg-emerald-500 text-slate-950 animate-pulse' 
                                : isNext 
                                  ? 'bg-indigo-600 text-white' 
                                  : 'bg-slate-900 text-slate-400 border border-slate-800'
                            }`}>
                              {index + 1}
                            </span>
                            
                            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-slate-200 truncate">{j.name}</span>
                                {isCurrent && (
                                  <span className="bg-emerald-950 border border-emerald-500 text-emerald-300 text-[9px] font-semibold px-2 py-0.5 rounded-full animate-pulse uppercase">
                                    Running
                                  </span>
                                )}
                                {isNext && (
                                  <span className="bg-indigo-950 border border-indigo-500 text-indigo-300 text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase">
                                    Next Trigger
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-500 truncate font-mono">{j.search_url}</p>
                              {isNext && (
                                <p className="text-[9px] text-indigo-400 mt-0.5">
                                  {secondsLeft > 0 && countdownJobName === j.name ? (
                                    <span className="text-amber-400 font-semibold animate-pulse">
                                      ⏰ Starting in: {Math.floor(secondsLeft / 60)}m {secondsLeft % 60}s
                                    </span>
                                  ) : (
                                    <>Running at: <strong>{new Date(j.next_run).toLocaleTimeString()}</strong></>
                                  )}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Reorder & Action Controls */}
                          <div className="flex items-center gap-1 bg-slate-900/50 p-1 border border-slate-900 rounded-lg shrink-0">
                            <button
                              onClick={async () => {
                                try {
                                  await fetch(`${API_BASE}/jobs/${j.id}/run`, { method: 'POST' });
                                  showFeedback('success', `Initiated scraper chain starting from ${j.name}.`);
                                  fetchJobs();
                                } catch (err) {
                                  showFeedback('error', 'Failed to trigger.');
                                }
                              }}
                              className="p-1.5 rounded-md text-emerald-450 hover:bg-slate-800 hover:text-emerald-300 active:scale-90 cursor-pointer"
                              title={isNext ? "Skip Delay and Run Now" : "Start Execution Chain from here"}
                            >
                              <Play className="w-4 h-4 fill-current" />
                            </button>
                            {chainActive && (
                              <button
                                onClick={handleStopChain}
                                className="p-1.5 rounded-md text-rose-400 hover:bg-slate-800 hover:text-rose-300 active:scale-90 cursor-pointer"
                                title="Interrupt/Stop Execution Chain"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              disabled={index === 0}
                              onClick={() => handleReorderJob(index, 'up')}
                              className={`p-1.5 rounded-md transition ${
                                index === 0 
                                  ? 'text-slate-700 cursor-not-allowed' 
                                  : 'text-slate-400 hover:bg-slate-800 hover:text-white active:scale-90 cursor-pointer'
                              }`}
                              title="Move Up"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button
                              disabled={index === arr.length - 1}
                              onClick={() => handleReorderJob(index, 'down')}
                              className={`p-1.5 rounded-md transition ${
                                index === arr.length - 1 
                                  ? 'text-slate-700 cursor-not-allowed' 
                                  : 'text-slate-400 hover:bg-slate-800 hover:text-white active:scale-90 cursor-pointer'
                              }`}
                              title="Move Down"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

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
              
              <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center">
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
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-medium"
                >
                  <option value="">All Marketplaces</option>
                  <option value="shopee">Shopee</option>
                  <option value="tokopedia">Tokopedia</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-medium"
                >
                  <option value="scraped_at">Sort by Date</option>
                  <option value="price">Sort by Price</option>
                  <option value="price_change">Sort by Price Change</option>
                  <option value="rating">Sort by Rating</option>
                  <option value="sold">Sort by Sold</option>
                </select>

                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 font-medium"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
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
                        <th className="p-3.5 pl-4">Product Info</th>
                        <th className="p-3.5">Store Details</th>
                        <th className="p-3.5">Pricing</th>
                        <th className="p-3.5">Performance</th>
                        <th className="p-3.5">Source & Campaign</th>
                        <th className="p-3.5 pr-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {products.map(p => (
                        <tr key={p.id} className="hover:bg-slate-900/40 text-slate-300">
                          {/* 1. Product Info */}
                          <td className="p-3 pl-4 max-w-[280px]">
                            <div className="flex flex-col gap-0.5">
                              {p.url ? (
                                <a 
                                  href={p.url.startsWith('http') ? p.url : `https://${p.source === 'shopee' ? 'shopee.co.id' : 'www.tokopedia.com'}${p.url}`}
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-indigo-400 hover:text-indigo-300 hover:underline font-bold transition line-clamp-2"
                                  title={p.product_name}
                                >
                                  {p.product_name}
                                </a>
                              ) : (
                                <span className="font-bold text-slate-200 line-clamp-2" title={p.product_name}>{p.product_name}</span>
                              )}
                              <span className="text-[10px] text-slate-500 font-mono">Scraped: {new Date(p.scraped_at).toLocaleString()}</span>
                            </div>
                          </td>

                          {/* 2. Store Details */}
                          <td className="p-3 max-w-[180px]">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-slate-200 truncate" title={p.store_name || '-'}>
                                🏪 {p.store_name || '-'}
                              </span>
                              <span className="text-[10px] text-slate-400 truncate">
                                {p.store_type || 'Regular'} • {p.store_location || '-'}
                              </span>
                            </div>
                          </td>

                          {/* 3. Pricing */}
                          <td className="p-3">
                            <div className="flex flex-col gap-0.5 font-mono">
                              {p.discount_price ? (
                                <>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-emerald-400 font-bold text-sm">{p.discount_price}</span>
                                    {p.discount_percentage && (
                                      <span className="px-1 py-0.5 text-[9px] font-bold bg-rose-950/60 border border-rose-500/30 text-rose-300 rounded">
                                        {p.discount_percentage}
                                      </span>
                                    )}
                                    {p.price_change !== 0 && renderPriceChangeBadge(p.price_change)}
                                  </div>
                                  <span className="text-[10px] text-slate-500 line-through">{p.original_price}</span>
                                </>
                              ) : (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-slate-200 font-semibold text-sm">{p.original_price || 'N/A'}</span>
                                  {p.price_change !== 0 && renderPriceChangeBadge(p.price_change)}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* 4. Performance Stats */}
                          <td className="p-3">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1">
                                <span className="text-amber-400 text-xs">⭐</span>
                                <span className="font-bold text-slate-200">{p.rating || '0.0'}</span>
                              </div>
                              <span className="text-[10px] text-slate-400 font-medium">🛍️ {p.sold_count || '0 sold'}</span>
                            </div>
                          </td>

                          {/* 5. Source & Badges */}
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1 items-center max-w-[200px]">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                                p.source === 'shopee' 
                                  ? 'bg-indigo-950/60 border-indigo-500/50 text-indigo-300' 
                                  : 'bg-purple-950/60 border-purple-500/50 text-purple-300'
                              }`}>
                                {p.source}
                              </span>
                              {p.job_name && (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold border border-slate-700/80 bg-slate-900 text-slate-300 truncate max-w-[100px]" title={p.job_name}>
                                  💼 {p.job_name}
                                </span>
                              )}
                              {p.query_keyword && (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold border border-slate-750 bg-slate-950 text-slate-400 truncate max-w-[100px]" title={p.query_keyword}>
                                  🔍 {p.query_keyword}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 6. Actions */}
                          <td className="p-3 pr-4 text-right">
                            <button
                              onClick={() => handleViewPriceHistory(p)}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-2.5 py-1.5 rounded-lg text-[10px] flex items-center gap-1 transition ml-auto cursor-pointer"
                              title="View item price history and trends"
                            >
                              <TrendingUp className="w-3.5 h-3.5" /> Price History
                            </button>
                          </td>
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
                        <div className="flex flex-wrap gap-1 items-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                            p.source === 'shopee' 
                              ? 'bg-indigo-950 border-indigo-500 text-indigo-300' 
                              : 'bg-purple-950 border-purple-500 text-purple-300'
                          }`}>
                            {p.source}
                          </span>
                          {p.job_name && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-slate-700 bg-slate-900 text-slate-300">
                              💼 {p.job_name}
                            </span>
                          )}
                          {p.query_keyword && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-slate-750 bg-slate-950 text-slate-400">
                              🔍 {p.query_keyword}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">{new Date(p.scraped_at).toLocaleDateString()}</span>
                      </div>
                      <h4 className="font-bold text-white text-sm line-clamp-2">
                        {p.url ? (
                          <a 
                            href={p.url.startsWith('http') ? p.url : `https://${p.source === 'shopee' ? 'shopee.co.id' : 'www.tokopedia.com'}${p.url}`}
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-indigo-400 hover:text-indigo-300 hover:underline transition"
                          >
                            {p.product_name}
                          </a>
                        ) : (
                          p.product_name
                        )}
                      </h4>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-800 pt-2.5 mt-1">
                        <div>
                          <span className="text-slate-500 block text-[10px]">Price:</span>
                          <span className="font-mono text-slate-300">{p.original_price || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Promo:</span>
                          <span className="font-mono text-emerald-400">{p.discount_price || '-'} ({p.discount_percentage || '-'})</span>
                        </div>
                        {p.price_change !== 0 && (
                          <div className="col-span-2">
                            <span className="text-slate-500 block text-[10px]">Price Change:</span>
                            {renderPriceChangeBadge(p.price_change)}
                          </div>
                        )}
                        <div>
                          <span className="text-slate-500 block text-[10px]">Rating:</span>
                          <span className="text-slate-300">⭐ {p.rating || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Sold:</span>
                          <span className="text-slate-300">{p.sold_count || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Store:</span>
                          <span className="text-slate-300 font-semibold truncate block max-w-[120px]" title={p.store_name}>{p.store_name || '-'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Store Type:</span>
                          <span className="text-slate-300 truncate block">{p.store_type || 'Regular'}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-slate-500 block text-[10px]">Location:</span>
                          <span className="text-slate-300 text-xs truncate block">{p.store_location || 'N/A'}</span>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => handleViewPriceHistory(p)}
                        className="w-full mt-2 bg-slate-900 hover:bg-slate-850 text-slate-200 border border-slate-850 font-semibold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                      >
                        <TrendingUp className="w-3.5 h-3.5 text-indigo-400" /> View Price History
                      </button>
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
                <select
                  required
                  value={newJob.script_filename}
                  onChange={(e) => setNewJob({...newJob, script_filename: e.target.value})}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-mono cursor-pointer"
                >
                  {scripts.length === 0 ? (
                    <option value="">No scripts found - please upload one first</option>
                  ) : (
                    scripts.map(scr => (
                      <option key={scr} value={scr}>{scr}</option>
                    ))
                  )}
                </select>
                <p className="text-[10px] text-slate-500">Select an existing script file inside the backend/scripts directory.</p>
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
                    required={!newJob.continuous}
                    disabled={newJob.continuous}
                    value={newJob.continuous ? 'Continuous' : newJob.schedule_time}
                    onChange={(e) => setNewJob({...newJob, schedule_time: e.target.value})}
                    placeholder={newJob.continuous ? 'N/A - Continuous Mode' : 'e.g. 01:00 or 01:00-03:00'}
                    className={`bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-mono ${newJob.continuous ? 'opacity-50 cursor-not-allowed' : ''}`}
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">E.g., 01:30 (fixed) or 01:00-03:00 (random daily range).</p>
                </div>
              </div>

              <div className="flex flex-col gap-4 border-t border-slate-800 pt-4 mt-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={newJob.continuous}
                    onChange={(e) => setNewJob({...newJob, continuous: e.target.checked})}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-800 bg-slate-950 cursor-pointer"
                  />
                  <div>
                    <span className="text-sm font-semibold text-slate-200 group-hover:text-white transition">Continuous Scrape</span>
                    <p className="text-[10px] text-slate-500">Run scraper repeatedly (10s delay between runs) instead of once daily.</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={newJob.run_headless}
                    onChange={(e) => setNewJob({...newJob, run_headless: e.target.checked})}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-800 bg-slate-950 cursor-pointer"
                  />
                  <div>
                    <span className="text-sm font-semibold text-slate-200 group-hover:text-white transition">Run Headless</span>
                    <p className="text-[10px] text-slate-500">Keep browser window hidden in background.</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={newJob.enabled}
                    onChange={(e) => setNewJob({...newJob, enabled: e.target.checked})}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-800 bg-slate-950 cursor-pointer"
                  />
                  <div>
                    <span className="text-sm font-semibold text-slate-200 group-hover:text-white transition">Enable Job immediately</span>
                    <p className="text-[10px] text-slate-500">Start the schedule daemon right after creation.</p>
                  </div>
                </label>
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
                    required={!editJobForm.continuous}
                    disabled={editJobForm.continuous}
                    value={editJobForm.continuous ? 'Continuous' : editJobForm.schedule_time}
                    onChange={(e) => setEditJobForm({...editJobForm, schedule_time: e.target.value})}
                    placeholder={editJobForm.continuous ? 'N/A - Continuous Mode' : '01:00 or 01:00-03:00'}
                    className={`bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-mono ${editJobForm.continuous ? 'opacity-50 cursor-not-allowed' : ''}`}
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">E.g., 01:30 (fixed) or 01:00-03:00 (random daily range).</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-800 pt-3">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={editJobForm.continuous}
                    onChange={(e) => setEditJobForm({...editJobForm, continuous: e.target.checked})}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-800 bg-slate-950 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-200 group-hover:text-white transition">Continuous Scrape</span>
                    <p className="text-[9px] text-slate-500">Run scraper repeatedly (10s delay between runs) instead of once daily.</p>
                  </div>
                </label>
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

      {/* --- BULK ADD JOBS MODAL --- */}
      {showBulkAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full flex flex-col gap-4 shadow-xl">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Server className="w-5 h-5 text-indigo-400" />
                Bulk Add Scraping Jobs
              </h3>
              <p className="text-xs text-slate-400">Batch-create multiple scraping jobs at once by entering a list of search target URLs.</p>
            </div>

            <form onSubmit={handleBulkAddSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">Select Scraper Script:</label>
                <select
                  required
                  value={bulkJobForm.script_filename}
                  onChange={(e) => setBulkJobForm({...bulkJobForm, script_filename: e.target.value})}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-mono cursor-pointer"
                >
                  {scripts.length === 0 ? (
                    <option value="">No scripts found - please upload one first</option>
                  ) : (
                    scripts.map(scr => (
                      <option key={scr} value={scr}>{scr}</option>
                    ))
                  )}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">Target URLs (one per line):</label>
                <textarea
                  required
                  rows={4}
                  value={bulkJobForm.urls_input}
                  onChange={(e) => setBulkJobForm({...bulkJobForm, urls_input: e.target.value})}
                  placeholder="https://shopee.co.id/search?keyword=rtx+3050&#10;https://shopee.co.id/search?keyword=rtx+4060"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 min-h-[100px] font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">Max Pages:</label>
                  <input
                    type="number"
                    required
                    value={bulkJobForm.max_pages}
                    onChange={(e) => setBulkJobForm({...bulkJobForm, max_pages: parseInt(e.target.value) || 3})}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">Schedule Daily Time (HH:MM):</label>
                  <input
                    type="text"
                    required={!bulkJobForm.continuous}
                    disabled={bulkJobForm.continuous}
                    value={bulkJobForm.continuous ? 'Continuous' : bulkJobForm.schedule_time}
                    onChange={(e) => setBulkJobForm({...bulkJobForm, schedule_time: e.target.value})}
                    placeholder={bulkJobForm.continuous ? 'N/A - Continuous Mode' : '01:00 or 01:00-03:00'}
                    className={`bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-mono ${bulkJobForm.continuous ? 'opacity-50 cursor-not-allowed' : ''}`}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-800 pt-3">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={bulkJobForm.continuous}
                    onChange={(e) => setBulkJobForm({...bulkJobForm, continuous: e.target.checked})}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-800 bg-slate-950 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-200 group-hover:text-white transition">Continuous Scrape</span>
                    <p className="text-[9px] text-slate-500">Run scraper repeatedly (10s delay between runs).</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={bulkJobForm.run_headless}
                    onChange={(e) => setBulkJobForm({...bulkJobForm, run_headless: e.target.checked})}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-800 bg-slate-950 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-200 group-hover:text-white transition">Run Headless</span>
                    <p className="text-[9px] text-slate-500">Keep browser window hidden in background.</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={bulkJobForm.enabled}
                    onChange={(e) => setBulkJobForm({...bulkJobForm, enabled: e.target.checked})}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-800 bg-slate-950 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-200 group-hover:text-white transition">Enable Jobs immediately</span>
                    <p className="text-[9px] text-slate-500">Start the schedule daemon right after batch creation.</p>
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-3 mt-2 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setShowBulkAddModal(false)}
                  className="bg-slate-950 border border-slate-800 text-slate-300 hover:bg-slate-900 text-sm font-semibold px-5 py-2.5 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition"
                >
                  Batch Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Price History Modal */}
      {priceHistoryProduct && (
        <PriceHistoryModal
          product={priceHistoryProduct}
          priceHistoryData={priceHistoryData}
          loading={priceHistoryLoading}
          onClose={() => setPriceHistoryProduct(null)}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 bg-slate-950/80 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4">
          <p>© 2026 Mirai-47. Designed for native desktop automation on Linux Zorin OS PC.</p>
        </div>
      </footer>
    </div>
  );
}

function PriceHistoryModal({ product, priceHistoryData, loading, onClose }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    // Destroy previous chart if any
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }

    if (!loading && priceHistoryData && priceHistoryData.length > 0 && chartRef.current) {
      const ctx = chartRef.current.getContext('2d');

      // Sort chronological
      const sortedData = [...priceHistoryData].sort(
        (a, b) => new Date(a.scraped_at) - new Date(b.scraped_at)
      );

      const labels = sortedData.map(d => {
        const dt = new Date(d.scraped_at);
        return dt.toLocaleDateString('id-ID', { month: 'short', day: 'numeric' }) + ' ' + 
               dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      });

      const originalPrices = sortedData.map(d => d.original_price_cleaned || null);
      const discountPrices = sortedData.map(d => d.discount_price_cleaned || null);
      const hasDiscount = discountPrices.some(p => p !== null);

      const datasets = [];

      if (hasDiscount) {
        datasets.push({
          label: 'Active/Discount Price (IDR)',
          data: discountPrices.map((p, idx) => p || originalPrices[idx]),
          borderColor: '#10b981', // Emerald 500
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.35,
          fill: true,
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#0f172a',
          pointHoverRadius: 7,
          pointHoverBackgroundColor: '#10b981',
          pointHoverBorderColor: '#0f172a',
          pointRadius: 4
        });
        datasets.push({
          label: 'Original Price (IDR)',
          data: originalPrices,
          borderColor: 'rgba(148, 163, 184, 0.5)', // Slate 400
          borderDash: [5, 5],
          backgroundColor: 'transparent',
          tension: 0.35,
          fill: false,
          pointBackgroundColor: '#64748b',
          pointBorderColor: '#0f172a',
          pointHoverRadius: 5,
          pointRadius: 3
        });
      } else {
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.02)');

        datasets.push({
          label: 'Price (IDR)',
          data: originalPrices,
          borderColor: '#6366f1', // Indigo 500
          backgroundColor: gradient,
          tension: 0.35,
          fill: true,
          pointBackgroundColor: '#6366f1',
          pointBorderColor: '#0f172a',
          pointHoverRadius: 7,
          pointHoverBackgroundColor: '#6366f1',
          pointHoverBorderColor: '#0f172a',
          pointRadius: 4
        });
      }

      chartInstance.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: '#94a3b8',
                font: {
                  family: 'Inter, system-ui, sans-serif',
                  size: 11,
                  weight: '600'
                }
              }
            },
            tooltip: {
              backgroundColor: '#0f172a',
              borderColor: '#334155',
              borderWidth: 1,
              titleColor: '#f1f5f9',
              bodyColor: '#f8fafc',
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                label: function (context) {
                  let label = context.dataset.label || '';
                  if (label) {
                    label += ': ';
                  }
                  if (context.parsed.y !== null) {
                    label += new Intl.NumberFormat('id-ID', {
                      style: 'currency',
                      currency: 'IDR',
                      maximumFractionDigits: 0
                    }).format(context.parsed.y);
                  }
                  return label;
                }
              }
            }
          },
          scales: {
            x: {
              grid: {
                color: 'rgba(51, 65, 85, 0.15)'
              },
              ticks: {
                color: '#64748b',
                font: {
                  family: 'Inter, system-ui, sans-serif',
                  size: 9
                },
                maxRotation: 45,
                minRotation: 0
              }
            },
            y: {
              grid: {
                color: 'rgba(51, 65, 85, 0.15)'
              },
              ticks: {
                color: '#64748b',
                font: {
                  family: 'Inter, system-ui, sans-serif',
                  size: 10
                },
                callback: function (value) {
                  return new Intl.NumberFormat('id-ID', {
                    style: 'currency',
                    currency: 'IDR',
                    maximumFractionDigits: 0,
                    notation: 'compact'
                  }).format(value);
                }
              }
            }
          }
        }
      });
    }

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [priceHistoryData, loading]);

  if (!product) return null;

  return (
    <div className="fixed inset-0 bg-black/75 z-55 flex items-center justify-center p-4 backdrop-blur-md transition-all duration-300">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex flex-col gap-1 min-w-0 pr-4">
            <span className={`inline-self-start px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
              product.source === 'shopee' 
                ? 'bg-indigo-950/65 border-indigo-500/50 text-indigo-300' 
                : 'bg-purple-950/65 border-purple-500/50 text-purple-300'
            }`}>
              {product.source}
            </span>
            <h3 className="text-md font-bold text-white truncate mt-1" title={product.product_name}>
              📈 Price History: {product.product_name}
            </h3>
            <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
              Store: {product.store_name || '-'} • {product.store_location || '-'}
            </p>
          </div>
          
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-white p-2 hover:bg-slate-800 rounded-xl transition cursor-pointer"
          >
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto flex flex-col gap-6 bg-slate-900/40">
          
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
              <span className="text-xs text-slate-400 font-medium">Loading historical price records...</span>
            </div>
          ) : priceHistoryData.length === 0 ? (
            <div className="text-center py-20 text-slate-500 text-sm">
              <TrendingUp className="w-12 h-12 mx-auto text-slate-700 mb-3" />
              No price history data points recorded for this item yet.
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              
              {/* Stats Overview Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl">
                  <span className="text-[10px] text-slate-500 block font-semibold">CURRENT PRICE</span>
                  <span className="text-base font-mono font-bold text-emerald-400 mt-1 block">
                    {product.discount_price || product.original_price || 'N/A'}
                  </span>
                </div>
                <div className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl">
                  <span className="text-[10px] text-slate-500 block font-semibold">MINIMUM PRICE</span>
                  <span className="text-base font-mono font-bold text-slate-200 mt-1 block">
                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
                      Math.min(...priceHistoryData.map(d => d.discount_price_cleaned || d.original_price_cleaned || 0))
                    )}
                  </span>
                </div>
                <div className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl">
                  <span className="text-[10px] text-slate-500 block font-semibold">MAXIMUM PRICE</span>
                  <span className="text-base font-mono font-bold text-slate-200 mt-1 block">
                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
                      Math.max(...priceHistoryData.map(d => d.discount_price_cleaned || d.original_price_cleaned || 0))
                    )}
                  </span>
                </div>
                <div className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl">
                  <span className="text-[10px] text-slate-500 block font-semibold">TOTAL SCRAPES</span>
                  <span className="text-base font-mono font-bold text-indigo-400 mt-1 block">
                    {priceHistoryData.length} records
                  </span>
                </div>
              </div>

              {/* Chart Canvas Container */}
              <div className="bg-slate-950/80 border border-slate-850 p-4 rounded-2xl h-80 relative shadow-inner">
                <canvas ref={chartRef}></canvas>
              </div>

              {/* Price Log Table */}
              <div className="flex flex-col gap-2.5">
                <h4 className="text-xs font-bold text-slate-300">Historical Price Logs</h4>
                <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 bg-slate-950 font-semibold sticky top-0">
                          <th className="p-2.5 pl-4">Date & Time</th>
                          <th className="p-2.5">Original Price</th>
                          <th className="p-2.5">Active / Discount Price</th>
                          <th className="p-2.5 pr-4 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850">
                        {[...priceHistoryData].reverse().map((log, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/40 text-slate-300 font-mono">
                            <td className="p-2 pl-4 text-slate-400">
                              {new Date(log.scraped_at).toLocaleString('id-ID')}
                            </td>
                            <td className="p-2">{log.original_price || '-'}</td>
                            <td className="p-2 text-emerald-450 font-semibold">{log.discount_price || '-'}</td>
                            <td className="p-2 pr-4 text-right">
                              {log.discount_price ? (
                                <span className="bg-emerald-950/65 border border-emerald-500/20 text-emerald-400 text-[8px] font-bold px-1.5 py-0.5 rounded">
                                  PROMO
                                </span>
                              ) : (
                                <span className="bg-slate-900 border border-slate-800 text-slate-500 text-[8px] px-1.5 py-0.5 rounded">
                                  NORMAL
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex justify-end">
          <button 
            onClick={onClose}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition cursor-pointer active:scale-95"
          >
            Close Viewer
          </button>
        </div>

      </div>
    </div>
  );
}
