import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import {
  SignedIn,
  SignedOut,
  SignIn,
  UserButton,
  useAuth,
} from "@clerk/clerk-react";
import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  LineChart as ChartIcon,
  Search,
  Globe,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import ScanModal from "./components/ScanModal";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/sites";

export default function App() {
  return (
    <div>
      <SignedOut>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "100vh",
            backgroundColor: "#0f172a",
          }}
        >
          <SignIn routing="hash" />
        </div>
      </SignedOut>

      <SignedIn>
        <Dashboard />
      </SignedIn>
    </div>
  );
}

function Dashboard() {
  const { getToken } = useAuth();
  const [sites, setSites] = useState([]);
  const [stats, setStats] = useState({ total: 0, up: 0, down: 0, degraded: 0 });
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    alertWebhookUrl: "",
  });

  const [selectedSite, setSelectedSite] = useState(null);
  const [siteLogs, setSiteLogs] = useState([]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const getAuthHeaders = useCallback(async () => {
    const token = await getToken();
    return { headers: { Authorization: `Bearer ${token}` } };
  }, [getToken]);

  const fetchSites = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await axios.get(API_BASE, headers);
      setSites(res.data.sites);
      setStats(res.data.stats);
    } catch (err) {
      console.error("Failed to fetch sites:", err);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  const handleSelectSite = async (site) => {
    setSelectedSite(site);
    try {
      const headers = await getAuthHeaders();
      const res = await axios.get(`${API_BASE}/${site._id}/logs`, headers);
      const formattedLogs = res.data.map((log) => ({
        ...log,
        time: new Date(log.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      }));
      setSiteLogs(formattedLogs);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    }
  };

  useEffect(() => {
    fetchSites();
    const interval = setInterval(fetchSites, 30000);
    return () => clearInterval(interval);
  }, [fetchSites]);

  const openAddModal = () => {
    setEditingId(null);
    setFormData({ name: "", url: "", alertWebhookUrl: "" });
    setShowModal(true);
  };

  const openEditModal = (site, e) => {
    e.stopPropagation();
    setEditingId(site._id);
    setFormData({
      name: site.name,
      url: site.url,
      alertWebhookUrl: site.alertWebhookUrl || "",
    });
    setShowModal(true);
  };

  const handleSaveSite = async (e) => {
    e.preventDefault();
    try {
      const headers = await getAuthHeaders();
      if (editingId) {
        await axios.put(`${API_BASE}/${editingId}`, formData, headers);
      } else {
        await axios.post(API_BASE, formData, headers);
      }
      setFormData({ name: "", url: "", alertWebhookUrl: "" });
      setShowModal(false);
      fetchSites();
    } catch (err) {
      const errorMsg =
        err.response?.data?.message ||
        (editingId ? "Failed to update site" : "Failed to add site");
      alert(errorMsg);
    }
  };

  const handleManualPing = async (id, e) => {
    e.stopPropagation();
    try {
      const headers = await getAuthHeaders();
      await axios.post(`${API_BASE}/${id}/ping`, {}, headers);
      fetchSites();
      if (selectedSite && selectedSite._id === id) {
        handleSelectSite(selectedSite);
      }
    } catch (err) {
      alert("Manual ping failed");
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Delete this site and its logs?")) return;
    try {
      const headers = await getAuthHeaders();
      await axios.delete(`${API_BASE}/${id}`, headers);
      if (selectedSite && selectedSite._id === id) {
        setSelectedSite(null);
        setSiteLogs([]);
      }
      fetchSites();
    } catch (err) {
      alert("Failed to delete site");
    }
  };

  // Filter endpoints dynamically
  const filteredSites = sites.filter((site) => {
    const matchesSearch =
      site.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      site.url.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "ALL" || site.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div
      style={{
        padding: "2rem",
        fontFamily: "sans-serif",
        backgroundColor: "#0f172a",
        color: "#f8fafc",
        minHeight: "100vh",
      }}
    >
      {/* Top Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <h2>
          <Activity style={{ display: "inline", marginRight: "8px" }} /> Uptime
          Sentinel
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <button
            onClick={() => setShowScanModal(true)}
            style={{
              padding: "0.6rem 1.2rem",
              backgroundColor: "#1e293b",
              color: "#38bdf8",
              border: "1px solid #334155",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Globe size={16} /> Scan Repo
          </button>
          <button
            onClick={openAddModal}
            style={{
              padding: "0.6rem 1.2rem",
              backgroundColor: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            <Plus size={16} style={{ display: "inline", marginRight: "4px" }} />{" "}
            Add Endpoint
          </button>
          <UserButton
            showName={true}
            appearance={{ elements: { footer: { display: "none" } } }}
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <StatCard
          title="Total Monitored"
          value={stats.total}
          icon={<Activity color="#94a3b8" />}
        />
        <StatCard
          title="Healthy (UP)"
          value={stats.up}
          icon={<ShieldCheck color="#22c55e" />}
        />
        <StatCard
          title="Degraded (Latency)"
          value={stats.degraded}
          icon={<AlertTriangle color="#eab308" />}
        />
        <StatCard
          title="Down / Unreachable"
          value={stats.down}
          icon={<XCircle color="#ef4444" />}
        />
      </div>

      {/* Table Container */}
      <div
        style={{
          backgroundColor: "#1e293b",
          padding: "1.5rem",
          borderRadius: "8px",
          marginBottom: "2rem",
        }}
      >
        {/* Search & Status Filters */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.25rem",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <h3>
            Monitored Services{" "}
            <span
              style={{
                fontSize: "0.85rem",
                color: "#94a3b8",
                fontWeight: "normal",
              }}
            >
              (Click row to view graph below)
            </span>
          </h3>

          <div
            style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}
          >
            {/* Search Input */}
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Search
                size={16}
                style={{ position: "absolute", left: "10px", color: "#94a3b8" }}
              />
              <input
                type="text"
                placeholder="Filter services..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: "0.45rem 0.5rem 0.45rem 2.2rem",
                  backgroundColor: "#0f172a",
                  border: "1px solid #334155",
                  color: "#fff",
                  borderRadius: "6px",
                  fontSize: "0.875rem",
                  outline: "none",
                }}
              />
            </div>

            {/* Filter Buttons */}
            {["ALL", "UP", "DOWN", "DEGRADED"].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                style={{
                  padding: "0.45rem 0.8rem",
                  fontSize: "0.75rem",
                  fontWeight: "bold",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  backgroundColor:
                    statusFilter === status ? "#3b82f6" : "#0f172a",
                  color: statusFilter === status ? "#fff" : "#94a3b8",
                }}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p>Loading endpoints...</p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
            }}
          >
            <thead>
              <tr
                style={{ borderBottom: "1px solid #334155", color: "#94a3b8" }}
              >
                <th style={{ padding: "0.75rem" }}>Name</th>
                <th>URL</th>
                <th>Status</th>
                <th>Latency</th>
                <th>SSL Expiry</th>
                <th>Last Checked</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.length === 0 ? (
                <tr>
                  <td
                    colSpan="7"
                    style={{
                      padding: "1.5rem 0",
                      textAlign: "center",
                      color: "#94a3b8",
                    }}
                  >
                    No endpoints match your search.
                  </td>
                </tr>
              ) : (
                filteredSites.map((site) => (
                  <tr
                    key={site._id}
                    onClick={() => handleSelectSite(site)}
                    style={{
                      borderBottom: "1px solid #334155",
                      cursor: "pointer",
                      backgroundColor:
                        selectedSite?._id === site._id
                          ? "#334155"
                          : "transparent",
                    }}
                  >
                    <td style={{ padding: "0.75rem", fontWeight: "bold" }}>
                      {site.name}
                    </td>
                    <td>
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#38bdf8" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {site.url}
                      </a>
                    </td>
                    <td>
                      <StatusBadge status={site.status} />
                    </td>

                    {/* Latency Cell */}
                    <td>
                      {site.status === "DOWN" ? (
                        <span style={{ color: "#ef4444", fontWeight: "bold" }}>
                          TIMEOUT
                        </span>
                      ) : (
                        `${site.lastResponseTime} ms`
                      )}
                    </td>

                    {/* Color-Coded SSL Expiry */}
                    <td>
                      <SslBadge days={site.sslDaysRemaining} />
                    </td>

                    {/* Relative Timestamp */}
                    <td style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                      {timeAgo(site.lastChecked)}
                    </td>

                    <td>
                      <button
                        onClick={(e) => handleManualPing(site._id, e)}
                        style={{
                          marginRight: "8px",
                          background: "none",
                          border: "none",
                          color: "#38bdf8",
                          cursor: "pointer",
                        }}
                      >
                        <RefreshCw size={18} />
                      </button>
                      <button
                        onClick={(e) => openEditModal(site, e)}
                        style={{
                          marginRight: "8px",
                          background: "none",
                          border: "none",
                          color: "#eab308",
                          cursor: "pointer",
                        }}
                      >
                        <Pencil size={18} />
                      </button>
                      <button
                        onClick={(e) => handleDelete(site._id, e)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#ef4444",
                          cursor: "pointer",
                        }}
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Latency History Chart with Red Down Dots */}
      {selectedSite && (
        <div
          style={{
            backgroundColor: "#1e293b",
            padding: "1.5rem",
            borderRadius: "8px",
          }}
        >
          <h3
            style={{
              marginBottom: "1rem",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <ChartIcon size={20} color="#38bdf8" /> Latency History:{" "}
            <span style={{ color: "#38bdf8" }}>{selectedSite.name}</span>
          </h3>
          {siteLogs.length > 0 ? (
            <div style={{ width: "100%", height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={siteLogs}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} unit="ms" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      color: "#f8fafc",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="responseTime"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={({ cx, cy, payload }) => (
                      <circle
                        key={payload._id || Math.random()}
                        cx={cx}
                        cy={cy}
                        r={4}
                        fill={payload.status === "DOWN" ? "#ef4444" : "#38bdf8"}
                      />
                    )}
                    activeDot={{ r: 6 }}
                    name="Latency (ms)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p style={{ color: "#94a3b8" }}>No ping history recorded yet.</p>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <form
            onSubmit={handleSaveSite}
            style={{
              backgroundColor: "#1e293b",
              padding: "2rem",
              borderRadius: "8px",
              width: "400px",
            }}
          >
            <h3 style={{ marginBottom: "1rem" }}>
              {editingId ? "Edit Endpoint" : "Add Endpoint"}
            </h3>
            <input
              type="text"
              placeholder="Service Name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              required
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Target URL (e.g. https://github.com)"
              value={formData.url}
              onChange={(e) =>
                setFormData({ ...formData, url: e.target.value })
              }
              required
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Discord Webhook URL (Optional)"
              value={formData.alertWebhookUrl}
              onChange={(e) =>
                setFormData({ ...formData, alertWebhookUrl: e.target.value })
              }
              style={inputStyle}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "1rem",
              }}
            >
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#475569",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{
                  padding: "0.5rem 1rem",
                  background: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {editingId ? "Update" : "Add"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* GitHub Scan Modal */}
      {showScanModal && (
        <ScanModal
          onClose={() => setShowScanModal(false)}
          onSaved={() => {
            fetchSites();
            setShowScanModal(false);
          }}
        />
      )}
    </div>
  );
}

function StatCard({ title, value, icon }) {
  return (
    <div
      style={{
        backgroundColor: "#1e293b",
        padding: "1.25rem",
        borderRadius: "8px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div>
        <p
          style={{
            color: "#94a3b8",
            fontSize: "0.875rem",
            marginBottom: "0.25rem",
          }}
        >
          {title}
        </p>
        <h3 style={{ fontSize: "1.5rem", margin: 0 }}>{value}</h3>
      </div>
      {icon}
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    UP: { bg: "#166534", text: "#4ade80" },
    DEGRADED: { bg: "#854d0e", text: "#fde047" },
    DOWN: { bg: "#991b1b", text: "#fca5a5" },
  };
  const conf = styles[status] || styles.DOWN;
  return (
    <span
      style={{
        backgroundColor: conf.bg,
        color: conf.text,
        padding: "0.25rem 0.5rem",
        borderRadius: "4px",
        fontSize: "0.75rem",
        fontWeight: "bold",
      }}
    >
      {status}
    </span>
  );
}

function SslBadge({ days }) {
  if (days === null || days === undefined)
    return <span style={{ color: "#64748b" }}>N/A</span>;
  let color = "#4ade80";
  if (days <= 7) color = "#fca5a5";
  else if (days <= 30) color = "#fde047";
  return <span style={{ color, fontWeight: "bold" }}>{days} days</span>;
}

function timeAgo(date) {
  if (!date) return "Never";
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

const inputStyle = {
  width: "100%",
  padding: "0.75rem",
  marginBottom: "1rem",
  backgroundColor: "#0f172a",
  border: "1px solid #334155",
  color: "#fff",
  borderRadius: "4px",
  boxSizing: "border-box",
};
