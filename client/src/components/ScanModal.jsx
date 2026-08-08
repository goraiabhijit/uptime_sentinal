import React, { useState, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import {
  Github, Search, X, CheckSquare, Square, ChevronDown, ChevronRight,
  Loader, AlertCircle, CheckCircle, Save, Filter, Globe
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace('/api/sites', '') || 'http://localhost:5000';

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '1rem',
  },
  modal: {
    backgroundColor: '#1e293b', borderRadius: '12px', width: '100%', maxWidth: '860px',
    maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: '1px solid #334155', boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '1.25rem 1.5rem', borderBottom: '1px solid #334155',
    background: 'linear-gradient(135deg, #1e293b 0%, #0f2040 100%)',
  },
  body: { padding: '1.5rem', overflowY: 'auto', flex: 1 },
  footer: { padding: '1.25rem 1.5rem', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' },
  input: {
    width: '100%', padding: '0.65rem 1rem', backgroundColor: '#0f172a',
    border: '1px solid #334155', color: '#f8fafc', borderRadius: '8px',
    fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
  },
  btn: (variant = 'primary', disabled = false) => ({
    padding: '0.6rem 1.2rem', borderRadius: '8px', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: '600', fontSize: '0.875rem', opacity: disabled ? 0.5 : 1,
    backgroundColor: variant === 'primary' ? '#3b82f6' : variant === 'ghost' ? 'transparent' : '#475569',
    color: variant === 'ghost' ? '#94a3b8' : '#fff',
    display: 'flex', alignItems: 'center', gap: '6px',
  }),
  badge: (type) => {
    const colors = {
      GET: { bg: '#0e4429', text: '#4ade80' },
      POST: { bg: '#1c3d5a', text: '#38bdf8' },
      PUT: { bg: '#3b2a00', text: '#fbbf24' },
      PATCH: { bg: '#2d1a4a', text: '#c084fc' },
      DELETE: { bg: '#450a0a', text: '#fca5a5' },
      high: { bg: '#0e4429', text: '#4ade80' },
      low: { bg: '#3b2a00', text: '#fbbf24' },
    };
    const c = colors[type] || { bg: '#1e293b', text: '#94a3b8' };
    return {
      backgroundColor: c.bg, color: c.text, padding: '2px 8px',
      borderRadius: '4px', fontSize: '0.7rem', fontWeight: '700', fontFamily: 'monospace',
    };
  },
};

// ── Step Indicator ─────────────────────────────────────────────────────────────

function StepIndicator({ step }) {
  const steps = ['Scan Repo', 'Set Base URL', 'Review & Save'];
  return (
    <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem' }}>
      {steps.map((label, i) => {
        const idx = i + 1;
        const active = step === idx;
        const done = step > idx;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: '700',
                backgroundColor: done ? '#22c55e' : active ? '#3b82f6' : '#334155',
                color: '#fff',
              }}>
                {done ? '✓' : idx}
              </div>
              <span style={{ fontSize: '0.7rem', color: active ? '#f8fafc' : '#64748b', whiteSpace: 'nowrap' }}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, backgroundColor: done ? '#22c55e' : '#334155', margin: '0 8px', marginBottom: 18 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Error Banner ───────────────────────────────────────────────────────────────

function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;
  const messages = {
    repo_not_found: 'Repository not found. Double-check the owner/repo spelling.',
    repo_private_or_forbidden: 'Repository is private or access is forbidden. Provide a GitHub token (PAT) with repo read scope.',
    github_rate_limited: `GitHub API rate limit hit. Provide a GitHub token to raise the limit from 60 → 5,000 req/hr.${error.retryAfter ? ` Retry after: ${new Date(error.retryAfter * 1000).toLocaleTimeString()}` : ''}`,
    no_endpoints_detected: 'No API endpoints were detected. This repo may not use a supported framework (Express, Next.js, FastAPI) or have an OpenAPI/Postman spec.',
    invalid_input: 'Invalid input. Use the format: owner/repo (e.g. goraiabhijit/uptime_sentinal)',
  };
  const msg = messages[error.code] || error.message || 'An unexpected error occurred.';
  return (
    <div style={{ backgroundColor: '#450a0a', border: '1px solid #991b1b', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
      <AlertCircle size={16} color="#fca5a5" style={{ marginTop: 2, flexShrink: 0 }} />
      <p style={{ color: '#fca5a5', fontSize: '0.85rem', margin: 0, flex: 1 }}>{msg}</p>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 0 }}>
        <X size={14} />
      </button>
    </div>
  );
}

// ── Method Badge ───────────────────────────────────────────────────────────────

function MethodBadge({ method }) {
  return <span style={s.badge(method)}>{method}</span>;
}

// ── Confidence Badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }) {
  return (
    <span style={{ ...s.badge(confidence), fontSize: '0.65rem' }}>
      {confidence === 'high' ? '● HIGH' : '◐ LOW'}
    </span>
  );
}

// ── Main ScanModal Component ───────────────────────────────────────────────────

export default function ScanModal({ onClose, onSaved }) {
  const { getToken } = useAuth();

  // Wizard state
  const [step, setStep] = useState(1);

  // Step 1 — Scan
  const [repoInput, setRepoInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [scanResult, setScanResult] = useState(null);

  // Step 2 — Base URL
  const [baseUrl, setBaseUrl] = useState('');
  const baseUrlValid = useMemo(() => { try { new URL(baseUrl); return true; } catch { return false; } }, [baseUrl]);

  // Step 3 — Review
  const [endpoints, setEndpoints] = useState([]);
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [confFilter, setConfFilter] = useState('ALL');
  const [expandedSource, setExpandedSource] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  const getAuthHeaders = async () => {
    const token = await getToken();
    return { headers: { Authorization: `Bearer ${token}` } };
  };

  // ── Step 1: Scan handler ──────────────────────────────────────────────────

  const handleScan = async () => {
    setScanError(null);
    setScanning(true);
    try {
      const headers = await getAuthHeaders();
      const res = await axios.post(
        `${API_BASE}/api/scan/github`,
        { repo: repoInput.trim(), token: tokenInput || undefined },
        headers,
      );
      setScanResult(res.data);
      // Initialise endpoints with selected: true
      setEndpoints(res.data.endpoints.map(ep => ({ ...ep, selected: true, paramOverrides: {}, editingParams: false })));
      setStep(2);
    } catch (err) {
      const data = err.response?.data;
      setScanError(data || { message: err.message });
    } finally {
      setScanning(false);
    }
  };

  // ── Endpoint selection helpers ─────────────────────────────────────────────

  const toggleEndpoint = (id) =>
    setEndpoints(eps => eps.map(ep => ep.id === id ? { ...ep, selected: !ep.selected } : ep));

  const selectAll = () => setEndpoints(eps => eps.map(ep => ({ ...ep, selected: true })));
  const selectNone = () => setEndpoints(eps => eps.map(ep => ({ ...ep, selected: false })));

  const updateParam = (id, param, value) =>
    setEndpoints(eps => eps.map(ep => ep.id === id ? { ...ep, paramOverrides: { ...ep.paramOverrides, [param]: value } } : ep));

  const filteredEndpoints = useMemo(() => {
    return endpoints.filter(ep => {
      if (methodFilter !== 'ALL' && ep.method !== methodFilter) return false;
      if (confFilter !== 'ALL' && ep.confidence !== confFilter) return false;
      return true;
    });
  }, [endpoints, methodFilter, confFilter]);

  const selectedCount = endpoints.filter(ep => ep.selected).length;

  // Extract param names from path like /users/{id}/posts/{postId}
  const extractParams = (path) => {
    const matches = path.match(/\{(\w+)\}/g) || [];
    return matches.map(m => m.replace(/[{}]/g, ''));
  };

  // ── Step 3: Save handler ──────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const headers = await getAuthHeaders();
      const toSave = endpoints
        .filter(ep => ep.selected)
        .map(ep => ({ method: ep.method, path: ep.path, pathParamOverrides: ep.paramOverrides || {}, headers: {} }));

      const res = await axios.post(
        `${API_BASE}/api/monitors/batch`,
        { baseUrl, sourceRepo: repoInput.trim(), endpoints: toSave },
        headers,
      );
      setSaveResult(res.data);
      if (onSaved) onSaved();
    } catch (err) {
      setSaveResult({ error: err.response?.data?.message || err.message });
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>

        {/* Header */}
        <div style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Github size={20} color="#38bdf8" />
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc' }}>GitHub Endpoint Discovery</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={s.body}>
          <StepIndicator step={step} />

          {/* ── STEP 1: Repo Input ─────────────────────────────────────────── */}
          {step === 1 && (
            <div>
              <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
                Enter a GitHub repository and Uptime Sentinel will automatically discover its API endpoints from specs, routing conventions, or source code.
              </p>
              <ErrorBanner error={scanError} onDismiss={() => setScanError(null)} />

              <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
                Repository <span style={{ color: '#fca5a5' }}>*</span>
              </label>
              <div style={{ position: 'relative', marginBottom: '1rem' }}>
                <Github size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                <input
                  id="scan-repo-input"
                  style={{ ...s.input, paddingLeft: '2.25rem' }}
                  placeholder="owner/repo  or  https://github.com/owner/repo"
                  value={repoInput}
                  onChange={e => setRepoInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && repoInput.trim() && handleScan()}
                  autoFocus
                />
              </div>

              <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
                GitHub Token (Optional — raises rate limit from 60 → 5,000 req/hr)
              </label>
              <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
                <input
                  id="scan-token-input"
                  type={showToken ? 'text' : 'password'}
                  style={{ ...s.input, paddingRight: '5rem' }}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                />
                <button
                  onClick={() => setShowToken(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.75rem' }}
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>

              <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '0.75rem 1rem' }}>
                <p style={{ color: '#64748b', fontSize: '0.78rem', margin: 0 }}>
                  <strong style={{ color: '#94a3b8' }}>Supported:</strong> OpenAPI/Swagger specs · Postman collections · Next.js (App + Pages Router) · Express routes · FastAPI routers · Source code regex fallback
                </p>
              </div>
            </div>
          )}

          {/* ── STEP 2: Base URL ───────────────────────────────────────────── */}
          {step === 2 && scanResult && (
            <div>
              <div style={{ backgroundColor: '#0e4429', border: '1px solid #166534', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <CheckCircle size={15} color="#4ade80" />
                <p style={{ color: '#4ade80', fontSize: '0.85rem', margin: 0 }}>
                  Found <strong>{scanResult.endpoints.length}</strong> endpoint{scanResult.endpoints.length !== 1 ? 's' : ''} on branch <code style={{ backgroundColor: '#0f172a', padding: '1px 6px', borderRadius: 4 }}>{scanResult.defaultBranch}</code>
                  {scanResult.truncated && <span style={{ color: '#fbbf24' }}> (tree was truncated — results may be incomplete)</span>}
                </p>
              </div>

              {scanResult.warnings?.length > 0 && (
                <div style={{ backgroundColor: '#3b2a00', border: '1px solid #92400e', borderRadius: '8px', padding: '0.65rem 1rem', marginBottom: '1rem' }}>
                  {scanResult.warnings.map((w, i) => <p key={i} style={{ color: '#fbbf24', fontSize: '0.8rem', margin: 0 }}>⚠ {w}</p>)}
                </div>
              )}

              <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
                Base URL <span style={{ color: '#fca5a5' }}>*</span>
              </label>
              <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
                <Globe size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                <input
                  id="scan-base-url"
                  style={{ ...s.input, paddingLeft: '2.25rem', borderColor: baseUrl && !baseUrlValid ? '#ef4444' : '#334155' }}
                  placeholder="https://api.your-deployment.com"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  autoFocus
                />
              </div>
              {baseUrl && !baseUrlValid && (
                <p style={{ color: '#fca5a5', fontSize: '0.78rem', marginBottom: '1rem' }}>⚠ Enter a valid URL including https://</p>
              )}
              <p style={{ color: '#64748b', fontSize: '0.78rem', marginTop: '0.5rem' }}>
                This will be prepended to each discovered path, e.g. <code style={{ color: '#94a3b8' }}>{baseUrl || 'https://api.example.com'}/users/&#123;id&#125;</code>
              </p>
            </div>
          )}

          {/* ── STEP 3: Review Table ───────────────────────────────────────── */}
          {step === 3 && (
            <div>
              {/* Filters + Bulk Actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{selectedCount}/{endpoints.length} selected</span>
                  <button onClick={selectAll} style={s.btn('secondary')}>All</button>
                  <button onClick={selectNone} style={s.btn('secondary')}>None</button>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Filter size={14} color="#64748b" />
                  {/* Method filter */}
                  <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)}
                    style={{ ...s.input, width: 'auto', padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}>
                    {['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m}>{m}</option>)}
                  </select>
                  {/* Confidence filter */}
                  <select value={confFilter} onChange={e => setConfFilter(e.target.value)}
                    style={{ ...s.input, width: 'auto', padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}>
                    {['ALL', 'high', 'low'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Save result banner */}
              {saveResult && !saveResult.error && (
                <div style={{ backgroundColor: '#0e4429', border: '1px solid #166534', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '0.75rem', display: 'flex', gap: '8px' }}>
                  <CheckCircle size={16} color="#4ade80" />
                  <p style={{ color: '#4ade80', fontSize: '0.85rem', margin: 0 }}>
                    ✅ Saved {saveResult.created} new + {saveResult.updated} updated monitors. Initial health checks are running in the background.
                  </p>
                </div>
              )}
              {saveResult?.error && (
                <div style={{ backgroundColor: '#450a0a', border: '1px solid #991b1b', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
                  <p style={{ color: '#fca5a5', fontSize: '0.85rem', margin: 0 }}>❌ {saveResult.error}</p>
                </div>
              )}

              {/* Endpoint table */}
              <div style={{ border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#0f172a', color: '#64748b', textAlign: 'left' }}>
                      <th style={{ padding: '0.6rem 0.75rem', width: 32 }}></th>
                      <th style={{ padding: '0.6rem 0.5rem', width: 70 }}>Method</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Path</th>
                      <th style={{ padding: '0.6rem 0.5rem', width: 80 }}>Confidence</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEndpoints.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No endpoints match your filters.</td></tr>
                    )}
                    {filteredEndpoints.map((ep) => {
                      const params = extractParams(ep.path);
                      const isExpanded = expandedSource === ep.id;
                      return (
                        <React.Fragment key={ep.id}>
                          <tr
                            style={{ borderTop: '1px solid #334155', backgroundColor: ep.selected ? 'transparent' : 'rgba(0,0,0,0.2)', cursor: 'pointer' }}
                            onClick={() => toggleEndpoint(ep.id)}
                          >
                            <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                              {ep.selected
                                ? <CheckSquare size={16} color="#3b82f6" />
                                : <Square size={16} color="#64748b" />}
                            </td>
                            <td style={{ padding: '0.6rem 0.5rem' }}><MethodBadge method={ep.method} /></td>
                            <td style={{ padding: '0.6rem 0.5rem', fontFamily: 'monospace', color: ep.selected ? '#f8fafc' : '#64748b' }}>{ep.path}</td>
                            <td style={{ padding: '0.6rem 0.5rem' }}><ConfidenceBadge confidence={ep.confidence} /></td>
                            <td style={{ padding: '0.6rem 0.5rem', color: '#64748b', fontSize: '0.75rem' }}>
                              <button
                                onClick={e => { e.stopPropagation(); setExpandedSource(isExpanded ? null : ep.id); }}
                                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                              >
                                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                {ep.sourceFile?.split('/').pop()}
                              </button>
                            </td>
                          </tr>
                          {/* Expanded: source file path + param editors */}
                          {isExpanded && (
                            <tr style={{ backgroundColor: '#0f172a', borderTop: '1px solid #1e293b' }}>
                              <td colSpan={5} style={{ padding: '0.75rem 1rem' }}>
                                <p style={{ color: '#64748b', fontSize: '0.75rem', fontFamily: 'monospace', marginBottom: params.length ? '0.5rem' : 0 }}>
                                  📄 {ep.sourceFile}{ep.sourceLine ? `:${ep.sourceLine}` : ''}
                                </p>
                                {params.length > 0 && (
                                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    {params.map(param => (
                                      <div key={param} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <code style={{ color: '#c084fc', fontSize: '0.75rem' }}>{`{${param}}`}</code>
                                        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>=</span>
                                        <input
                                          type="text"
                                          placeholder={param}
                                          value={ep.paramOverrides?.[param] || ''}
                                          onClick={e => e.stopPropagation()}
                                          onChange={e => updateParam(ep.id, param, e.target.value)}
                                          style={{ ...s.input, width: 100, padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {scanResult?.duplicatesFound?.length > 0 && (
                <p style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                  ℹ {scanResult.duplicatesFound.length} duplicate endpoint{scanResult.duplicatesFound.length !== 1 ? 's' : ''} were deduplicated (highest-confidence source kept).
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          {step === 1 && (
            <>
              <button onClick={onClose} style={s.btn('secondary')}>Cancel</button>
              <button
                id="scan-repo-btn"
                onClick={handleScan}
                disabled={!repoInput.trim() || scanning}
                style={s.btn('primary', !repoInput.trim() || scanning)}
              >
                {scanning ? <Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={15} />}
                {scanning ? 'Scanning…' : 'Scan Repository'}
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} style={s.btn('secondary')}>← Back</button>
              <button
                id="scan-next-btn"
                onClick={() => setStep(3)}
                disabled={!baseUrlValid}
                style={s.btn('primary', !baseUrlValid)}
              >
                Review Endpoints →
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button onClick={() => { setSaveResult(null); setStep(2); }} style={s.btn('secondary')}>← Back</button>
              <button
                id="scan-save-btn"
                onClick={handleSave}
                disabled={selectedCount === 0 || saving || !!saveResult?.monitorIds}
                style={s.btn('primary', selectedCount === 0 || saving || !!saveResult?.monitorIds)}
              >
                {saving ? <Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={15} />}
                {saving ? 'Saving…' : saveResult?.monitorIds ? '✓ Saved' : `Save ${selectedCount} Monitor${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
