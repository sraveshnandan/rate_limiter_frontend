import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

// ─── EndPointCard is defined OUTSIDE App to prevent remounting on every render ───
function EndPointCard({ title, description, endpointKey, endpoint, useUserId, userId, setUserId, isBursting, onHit, onBurst, onClear, history }) {
  const logs = history[endpointKey] || [];
  const latest = logs[0];
  const madeRequests = logs.length;
  const throttledRequests = logs.filter(l => !l.ok).length;

  // Reset this card's logs when the userId changes (new user = new rate limit bucket)
  const prevUserRef = useRef(userId);
  useEffect(() => {
    if (useUserId && prevUserRef.current !== userId) {
      prevUserRef.current = userId;
      onClear(endpointKey);
    }
  }, [userId, useUserId, endpointKey, onClear]);

  return (
    <div className="card">
      <div className="card-header">
        <h2>{title}</h2>
        <button className="clear-btn" onClick={() => onClear(endpointKey)}>Clear Logs</button>
      </div>
      <p className="description">{description}</p>

      {useUserId && (
        <div className="input-group">
          <label>User ID (changes reset rate limit bucket)</label>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. user-123"
          />
        </div>
      )}

      <div className="btn-group">
        <button className="btn primary" onClick={() => onHit(endpointKey, endpoint, useUserId)}>
          Send 1 Request
        </button>
        <button className="btn burst" onClick={() => onBurst(endpointKey, endpoint, useUserId)} disabled={isBursting}>
          {isBursting ? 'Bursting...' : 'Burst 15 Requests'}
        </button>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-pill">Sent: <b>{madeRequests}</b></div>
        <div className={`stat-pill ${throttledRequests > 0 ? 'stat-danger' : ''}`}>
          Throttled: <b>{throttledRequests}</b>
        </div>
        {latest && latest.remaining != null && (
          <div className="stat-pill">Remaining: <b>{latest.remaining}</b></div>
        )}
      </div>

      {/* Latest result banner */}
      {latest && (
        <div className={`latest-result ${latest.error ? 'net-error' : latest.ok ? 'success' : 'error'}`}>
          <div className="flex-row">
            <strong>
              {latest.error
                ? '⚠ Network Error – Is backend running?'
                : latest.ok
                  ? `✅ ${latest.status} Allowed`
                  : `🚫 ${latest.status} Too Many Requests`}
            </strong>
            {!latest.error && <span className="latency">{latest.time}ms</span>}
          </div>
          {!latest.error && latest.limit && (
            <div className="metrics">
              <div className="metric"><span>Limit:</span> <b>{latest.limit}</b></div>
              <div className="metric"><span>Remaining:</span> <b>{latest.remaining}</b></div>
              {!latest.ok && latest.retryAfter && (
                <div className="metric retry"><span>Retry After:</span> <b>{latest.retryAfter}s</b></div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Scrollable log */}
      {logs.length > 0 && (
        <div className="logs-container">
          <h4>Request Log (newest first)</h4>
          <div className="logs">
            {logs.map(log => (
              <div key={log.id} className={`log-row ${log.error ? 'log-fail' : log.ok ? 'log-success' : 'log-rate-limited'}`}>
                <span className="log-time">{log.timestamp}</span>
                <span className="log-status">{log.error ? 'ERR' : log.status}</span>
                {log.remaining != null && <span className="log-rem">Rem: {log.remaining}</span>}
                {!log.error && <span className="log-latency">{log.time}ms</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ───
function App() {
  const [history, setHistory] = useState({ basic: [], custom: [], health: [] });
  const [chartData, setChartData] = useState([{ time: '–', allowed: 0, throttled: 0 }]);
  const [userId, setUserId] = useState('user-123');
  const [isBursting, setIsBursting] = useState(false);
  const [config, setConfig] = useState({ global_limit: 10, global_window: 60, endpoint_limit: 4, endpoint_window: 20 });
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState('');
  const [aiInsight, setAiInsight] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const totals = useRef({ allowed: 0, throttled: 0, errors: 0 });

  const updateChart = (ok) => {
    const time = new Date().toLocaleTimeString();
    if (ok) totals.current.allowed++;
    else totals.current.throttled++;
    setChartData(prev => [...prev, { time, allowed: totals.current.allowed, throttled: totals.current.throttled }].slice(-20));
  };

  const hitEndpoint = async (key, endpoint, withUserId = false) => {
    try {
      const headers = {};
      if (withUserId && userId) headers['x-user-id'] = userId;
      const t0 = performance.now();
      const res = await fetch(`${API_BASE}${endpoint}`, { headers });
      const t1 = performance.now();
      let data = {};
      try { data = await res.json(); } catch (_) {}
      const entry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toLocaleTimeString(),
        status: res.status,
        ok: res.ok,
        data,
        limit: res.headers.get('ratelimit-limit'),
        remaining: res.headers.get('ratelimit-remaining'),
        retryAfter: res.headers.get('retry-after') || res.headers.get('ratelimit-reset'),
        time: Math.round(t1 - t0),
      };
      setHistory(prev => ({ ...prev, [key]: [entry, ...prev[key]].slice(0, 25) }));
      updateChart(res.ok);
    } catch (err) {
      const entry = { id: crypto.randomUUID(), timestamp: new Date().toLocaleTimeString(), error: true, ok: false, time: 0 };
      setHistory(prev => ({ ...prev, [key]: [entry, ...prev[key]].slice(0, 25) }));
      totals.current.errors++;
    }
  };

  const burstEndpoint = async (key, endpoint, withUserId = false) => {
    setIsBursting(true);
    await Promise.allSettled(Array.from({ length: 15 }, () => hitEndpoint(key, endpoint, withUserId)));
    setIsBursting(false);
  };

  const clearHistory = (key) => setHistory(prev => ({ ...prev, [key]: [] }));

  const applyConfig = async () => {
    setIsUpdatingConfig(true);
    setConfigMsg('');
    try {
      const res = await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          global_limit: parseInt(config.global_limit),
          global_window: parseInt(config.global_window),
          endpoint_limit: parseInt(config.endpoint_limit),
          endpoint_window: parseInt(config.endpoint_window),
        }),
      });
      const data = await res.json();
      setConfigMsg(data.message || 'Applied!');
    } catch {
      setConfigMsg('❌ Failed – Is backend running on port 8000?');
    }
    setIsUpdatingConfig(false);
  };

  const generateAIInsight = async () => {
    setIsAnalyzing(true);
    setAiInsight(null);
    try {
      const res = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metrics: totals.current }),
      });
      const data = await res.json();
      if (data.error) setAiInsight({ error: data.error });
      else setAiInsight(data.insight_data);
    } catch {
      setAiInsight({ error: 'Failed to connect to backend.' });
    }
    setIsAnalyzing(false);
  };

  return (
    <div className="dashboard">
      <header className="header">
        <div className="badge">Rate Limiter Analytics Hub</div>
        <h1>Test, Analyze &amp; Configure</h1>
        <p>Live sliding-window metrics, hot-swappable limits, and Gemini AI defense insights.</p>
      </header>

      {/* Top panel: Chart + Config + AI */}
      <div className="top-panel">
        {/* Chart */}
        <div className="card chart-card">
          <h2>Live Request Analytics</h2>
          <p className="description">Cumulative allowed (green) vs. throttled 429s (red) over time.</p>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tick={{ fill: '#94a3b8' }} />
                <YAxis stroke="#94a3b8" fontSize={11} tick={{ fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ background: '#0f141e', border: '1px solid #3b82f6', borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="allowed" stroke="#10b981" strokeWidth={2} dot={false} name="Allowed" />
                <Line type="monotone" dataKey="throttled" stroke="#ef4444" strokeWidth={2} dot={false} name="Throttled" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Config + AI stacked */}
        <div className="side-stack">
          <div className="card">
            <h2>Dynamic Configuration</h2>
            <p className="description">Hot-swap limits in real-time. No restart needed.</p>
            <div className="config-grid">
              <div className="input-group">
                <label>Global Limit</label>
                <input type="number" min="1" value={config.global_limit} onChange={e => setConfig(c => ({ ...c, global_limit: e.target.value }))} />
              </div>
              <div className="input-group">
                <label>Global Window (s)</label>
                <input type="number" min="1" value={config.global_window} onChange={e => setConfig(c => ({ ...c, global_window: e.target.value }))} />
              </div>
              <div className="input-group">
                <label>Endpoint Limit</label>
                <input type="number" min="1" value={config.endpoint_limit} onChange={e => setConfig(c => ({ ...c, endpoint_limit: e.target.value }))} />
              </div>
              <div className="input-group">
                <label>Endpoint Window (s)</label>
                <input type="number" min="1" value={config.endpoint_window} onChange={e => setConfig(c => ({ ...c, endpoint_window: e.target.value }))} />
              </div>
            </div>
            <button className="btn primary full-width" onClick={applyConfig} disabled={isUpdatingConfig}>
              {isUpdatingConfig ? 'Applying...' : 'Apply New Limits'}
            </button>
            {configMsg && <p className="config-msg">{configMsg}</p>}
          </div>

          
        </div>
      </div>

      {/* Endpoint test cards */}
      <div className="cards-grid">
        <EndPointCard
          title="Basic Endpoint"
          description="Tests default tiers. Global: 10/min · Endpoint: 4/20s."
          endpointKey="basic" endpoint="/basic"
          history={history} isBursting={isBursting}
          userId={userId} setUserId={setUserId}
          onHit={hitEndpoint} onBurst={burstEndpoint} onClear={clearHistory}
        />
        <EndPointCard
          title="Custom User Keys"
          description="Rate limited per x-user-id. Change the ID below to get a fresh bucket."
          endpointKey="custom" endpoint="/custom" useUserId
          history={history} isBursting={isBursting}
          userId={userId} setUserId={setUserId}
          onHit={hitEndpoint} onBurst={burstEndpoint} onClear={clearHistory}
        />
        <EndPointCard
          title="Health By-pass"
          description="Skipped by the rate limiter entirely. Burst as much as you want."
          endpointKey="health" endpoint="/health"
          history={history} isBursting={isBursting}
          userId={userId} setUserId={setUserId}
          onHit={hitEndpoint} onBurst={burstEndpoint} onClear={clearHistory}
        />
      </div>
    </div>
  );
}

export default App;
