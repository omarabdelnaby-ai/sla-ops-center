import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ComposedChart,
} from 'recharts';
import { transformForecastData, calculateHealthScore } from '../lib/transformer';
import { predictChannel, generateRecommendations } from '../lib/prediction-engine';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwu_EWewvcKQ_gdlEYQR2KgWcumJnNJWftL6PJ7xa2_wZIh6oNjUkhJJQMsZdHY6T1wrQ/exec';

const CHANNELS = {
  chat: { label: 'Chat', icon: '💬', target: 85, color: '#00d4ff', colorDim: 'rgba(0,212,255,0.12)' },
  email: { label: 'Email', icon: '📧', target: 80, color: '#a78bfa', colorDim: 'rgba(167,139,250,0.12)' },
  phone: { label: 'Phone', icon: '📞', target: 80, color: '#00e68a', colorDim: 'rgba(0,230,138,0.12)' },
};
const TABS = ['overview', 'hourly', 'charts', 'forecast', 'actions'];
const TAB_LABELS = { overview: 'Overview', hourly: 'Hourly Detail', charts: 'Analytics', forecast: 'Day Forecast', actions: 'Actions' };
const REFRESH_INTERVAL = 60000;

export default function Dashboard() {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState('chat');
  const [isStale, setIsStale] = useState(false);
  const timerRef = useRef(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const rawRes = await fetch(`${SCRIPT_URL}?action=forecast&t=${Date.now()}`);
      if (!rawRes.ok) throw new Error(`HTTP ${rawRes.status}`);
      const rawData = await rawRes.json();

      const channels = transformForecastData(rawData);
      const predictions = {};
      for (const [name, chData] of Object.entries(channels || {})) {
        const hourly = Array.isArray(chData) ? chData : chData?.hourly || [];
        predictions[name] = predictChannel(hourly, name);
        predictions[name].health = calculateHealthScore(predictions[name]);
      }
      const recommendations = generateRecommendations(predictions);

      const json = {
        predictions,
        recommendations,
        meta: { timestamp: new Date().toISOString(), cached: false, stale: false },
      };

      setData(json);
      setLastUpdate(new Date());
      setIsStale(false);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(() => fetchData(true), REFRESH_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  if (loading && !data) return <LoadingScreen />;

  return (
    <div style={styles.app}>
      <Header lastUpdate={lastUpdate} isStale={isStale} onRefresh={() => fetchData()} error={error} data={data} />
      <nav style={styles.nav}>
        <div style={styles.navInner}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ ...styles.navTab, ...(tab === t ? styles.navTabActive : {}) }}>
              {TAB_LABELS[t]}
              {tab === t && <span style={styles.navIndicator} />}
            </button>
          ))}
        </div>
        <ChannelSelector selected={selectedChannel} onChange={setSelectedChannel} />
      </nav>
      <main style={styles.main}>
        {error && !data && <ErrorBanner message={error} onRetry={fetchData} />}
        {data && tab === 'overview' && <OverviewTab data={data} />}
        {data && tab === 'hourly' && <HourlyTab data={data} channel={selectedChannel} />}
        {data && tab === 'charts' && <ChartsTab data={data} channel={selectedChannel} />}
        {data && tab === 'forecast' && <ForecastTab data={data} channel={selectedChannel} />}
        {data && tab === 'actions' && <ActionsTab data={data} />}
      </main>
    </div>
  );
}

function Header({ lastUpdate, isStale, onRefresh, error, data }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  const overallHealth = data?.predictions ? Math.round(Object.values(data.predictions).reduce((s, p) => s + (p.health || 0), 0) / 3) : 0;

  return (
    <header style={styles.header}>
      <div style={styles.headerLeft}>
        <div style={styles.logoMark}>
          <span style={styles.logoIcon}>◆</span>
          <div>
            <h1 style={styles.logoText}>SLA OPS CENTER</h1>
            <span style={styles.logoSub}>Real-time Forecast Engine v2</span>
          </div>
        </div>
      </div>
      <div style={styles.headerCenter}>
        <div style={styles.healthPill}>
          <span style={{ ...styles.healthDot, background: overallHealth > 70 ? '#00e68a' : overallHealth > 40 ? '#ffb020' : '#ff4757' }} />
          <span style={styles.healthLabel}>System Health</span>
          <span style={{ ...styles.healthValue, color: overallHealth > 70 ? '#00e68a' : overallHealth > 40 ? '#ffb020' : '#ff4757' }}>{overallHealth}%</span>
        </div>
      </div>
      <div style={styles.headerRight}>
        <div style={styles.timeBlock}>
          <span style={styles.timeValue}>{time.toLocaleTimeString('en-US', { hour12: false })}</span>
          <span style={styles.timeSub}>
            {lastUpdate ? `Updated ${Math.round((Date.now() - lastUpdate.getTime()) / 1000)}s ago` : '—'}
            {isStale && <span style={{ color: '#ffb020', marginLeft: 6 }}>STALE</span>}
          </span>
        </div>
        <button onClick={onRefresh} style={styles.refreshBtn} title="Force refresh">↻</button>
      </div>
    </header>
  );
}

function ChannelSelector({ selected, onChange }) {
  return (
    <div style={styles.channelSelector}>
      {Object.entries(CHANNELS).map(([key, ch]) => (
        <button key={key} onClick={() => onChange(key)} style={{ ...styles.channelBtn, ...(selected === key ? { background: ch.colorDim, borderColor: ch.color, color: ch.color } : {}) }}>
          {ch.icon} {ch.label}
        </button>
      ))}
    </div>
  );
}

function OverviewTab({ data }) {
  const { predictions, recommendations } = data;
  return (
    <div style={styles.overviewGrid}>
      {Object.entries(CHANNELS).map(([key, ch], idx) => {
        const pred = predictions?.[key];
        if (!pred?.summary) return <EmptyCard key={key} channel={ch} />;
        return <ChannelCard key={key} channel={ch} channelKey={key} prediction={pred} delay={idx * 100} />;
      })}
      <div style={{ ...styles.recsPanel, animationDelay: '300ms' }} className="animate-fade-up">
        <h3 style={styles.recsPanelTitle}>⚡ Action Items</h3>
        {recommendations?.length > 0 ? recommendations.slice(0, 5).map((rec, i) => (
          <RecCard key={i} rec={rec} />
        )) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0' }}>All channels operating within normal parameters.</p>
        )}
      </div>
    </div>
  );
}

function ChannelCard({ channel, channelKey, prediction, delay }) {
  const { summary, hours, health } = prediction;
  const sparkData = (hours || []).slice(-12).map(h => ({ v: h.sla }));
  const slaColor = summary.overallSLA >= summary.target ? '#00e68a' : summary.overallSLA >= summary.target - 5 ? '#ffb020' : '#ff4757';
  const trendArrow = summary.trend === 'improving' ? '↗' : summary.trend === 'declining' ? '↘' : '→';

  return (
    <div style={{ ...styles.channelCard, animationDelay: `${delay}ms`, borderTop: `2px solid ${channel.color}` }} className="animate-fade-up">
      <div style={styles.cardHeader}>
        <span style={styles.cardIcon}>{channel.icon}</span>
        <span style={styles.cardLabel}>{channel.label}</span>
        <span style={{ ...styles.healthBadge, background: health > 70 ? 'var(--accent-green-dim)' : health > 40 ? 'var(--accent-amber-dim)' : 'var(--accent-red-dim)', color: health > 70 ? 'var(--accent-green)' : health > 40 ? 'var(--accent-amber)' : 'var(--accent-red)' }}>{health}%</span>
      </div>
      <div style={styles.slaBlock}>
        <span style={{ ...styles.slaValue, color: slaColor }}>{summary.overallSLA}%</span>
        <span style={styles.slaTarget}>/ {summary.target}% target</span>
      </div>
      <div style={styles.sparkContainer}>
        <ResponsiveContainer width="100%" height={48}>
          <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${channelKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={channel.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={channel.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={channel.color} strokeWidth={1.5} fill={`url(#grad-${channelKey})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div style={styles.cardMeta}>
        <MetaItem label="Trend" value={`${trendArrow} ${summary.trend}`} color={summary.trend === 'declining' ? '#ff4757' : summary.trend === 'improving' ? '#00e68a' : 'var(--text-secondary)'} />
        <MetaItem label="Gap" value={`${summary.gap > 0 ? '+' : ''}${summary.gap}pts`} color={summary.gap >= 0 ? '#00e68a' : '#ff4757'} />
        <MetaItem label="Risk" value={summary.risk.level} color={summary.risk.level === 'critical' ? '#ff4757' : summary.risk.level === 'high' ? '#ffb020' : '#00e68a'} />
      </div>
    </div>
  );
}

function MetaItem({ label, value, color }) {
  return (
    <div style={styles.metaItem}>
      <span style={styles.metaLabel}>{label}</span>
      <span style={{ ...styles.metaValue, color }}>{value}</span>
    </div>
  );
}

function EmptyCard({ channel }) {
  return (
    <div style={{ ...styles.channelCard, opacity: 0.5 }} className="animate-fade-up">
      <div style={styles.cardHeader}>
        <span style={styles.cardIcon}>{channel.icon}</span>
        <span style={styles.cardLabel}>{channel.label}</span>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '2rem 0', textAlign: 'center' }}>Awaiting data...</p>
    </div>
  );
}

function RecCard({ rec }) {
  const colors = { critical: '#ff4757', high: '#ffb020', medium: '#00d4ff', low: '#00e68a' };
  return (
    <div style={{ ...styles.recCard, borderLeft: `3px solid ${colors[rec.priority]}` }}>
      <div style={styles.recHeader}>
        <span style={{ ...styles.recPriority, color: colors[rec.priority] }}>{rec.priority.toUpperCase()}</span>
        <span style={styles.recChannel}>{rec.channel}</span>
      </div>
      <p style={styles.recAction}>{rec.action}</p>
      <p style={styles.recReason}>{rec.reason}</p>
    </div>
  );
}

function HourlyTab({ data, channel }) {
  const pred = data?.predictions?.[channel];
  const ch = CHANNELS[channel];
  if (!pred?.hours?.length) return <EmptyState message={`No hourly data for ${ch.label}`} />;

  return (
    <div className="animate-fade-up">
      <h2 style={styles.tabTitle}>{ch.icon} {ch.label} — Hourly Breakdown</h2>
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Hour', 'Type', 'SLA %', 'vs Target', 'Volume', 'Confidence', 'Risk'].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pred.hours.map((h, i) => {
              const gap = h.sla - pred.summary.target;
              const riskColors = { low: '#00e68a', medium: '#ffb020', high: '#ff4757', critical: '#ff4757' };
              return (
                <tr key={i} style={{ ...styles.tr, background: h.type === 'predicted' ? 'rgba(0,212,255,0.03)' : 'transparent' }}>
                  <td style={styles.td}><span style={styles.mono}>{String(h.hour).padStart(2, '0')}:00</span></td>
                  <td style={styles.td}>
                    <span style={{ ...styles.typeBadge, background: h.type === 'actual' ? 'var(--accent-green-dim)' : 'var(--accent-cyan-dim)', color: h.type === 'actual' ? 'var(--accent-green)' : 'var(--accent-cyan)' }}>{h.type === 'actual' ? 'ACTUAL' : 'PREDICTED'}</span>
                  </td>
                  <td style={{ ...styles.td, ...styles.mono, color: h.sla >= pred.summary.target ? '#00e68a' : h.sla >= pred.summary.target - 5 ? '#ffb020' : '#ff4757', fontWeight: 600 }}>{h.sla}%</td>
                  <td style={{ ...styles.td, ...styles.mono, color: gap >= 0 ? '#00e68a' : '#ff4757' }}>{gap > 0 ? '+' : ''}{gap.toFixed(1)}</td>
                  <td style={{ ...styles.td, ...styles.mono }}>{h.volume || h.estimatedVolume || '—'}</td>
                  <td style={styles.td}>
                    {h.confidence != null && (
                      <div style={styles.confidenceBar}>
                        <div style={{ ...styles.confidenceFill, width: `${h.confidence}%`, background: ch.color }} />
                        <span style={styles.confidenceText}>{h.confidence}%</span>
                      </div>
                    )}
                  </td>
                  <td style={styles.td}>
                    <span style={{ ...styles.riskDot, background: riskColors[h.risk] || '#00e68a' }} />
                    {h.risk || 'ok'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChartsTab({ data, channel }) {
  const pred = data?.predictions?.[channel];
  const ch = CHANNELS[channel];
  if (!pred?.hours?.length) return <EmptyState message="No chart data available" />;

  const chartData = pred.hours.map(h => ({
    hour: `${String(h.hour).padStart(2, '0')}:00`,
    sla: h.sla,
    target: pred.summary.target,
    volume: h.volume || h.estimatedVolume || 0,
    type: h.type,
    confidence: h.confidence || 100,
  }));

  return (
    <div className="animate-fade-up">
      <h2 style={styles.tabTitle}>{ch.icon} {ch.label} — Analytics</h2>
      <div style={styles.chartGrid}>
        <div style={styles.chartCard}>
          <h3 style={styles.chartTitle}>SLA Performance vs Target</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="hour" tick={{ fill: '#4a5568', fontSize: 11 }} />
              <YAxis domain={[40, 100]} tick={{ fill: '#4a5568', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#111923', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, fontFamily: 'JetBrains Mono' }} />
              <ReferenceLine y={pred.summary.target} stroke="#ff4757" strokeDasharray="5 5" strokeWidth={1} label={{ value: 'Target', fill: '#ff4757', fontSize: 10 }} />
              <defs>
                <linearGradient id="slaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ch.color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={ch.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="sla" fill="url(#slaGrad)" stroke={ch.color} strokeWidth={2} dot={{ r: 3, fill: ch.color }} name="SLA %" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div style={styles.chartCard}>
          <h3 style={styles.chartTitle}>Volume Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="hour" tick={{ fill: '#4a5568', fontSize: 11 }} />
              <YAxis tick={{ fill: '#4a5568', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#111923', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, fontFamily: 'JetBrains Mono' }} />
              <Bar dataKey="volume" name="Volume" radius={[4, 4, 0, 0]} fill={ch.color} fillOpacity={0.6} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={styles.chartCard}>
        <h3 style={styles.chartTitle}>Prediction Confidence</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData.filter(d => d.type === 'predicted')} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="hour" tick={{ fill: '#4a5568', fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fill: '#4a5568', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#111923', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, fontFamily: 'JetBrains Mono' }} />
            <Bar dataKey="confidence" name="Confidence %" radius={[4, 4, 0, 0]} fill="#a78bfa" fillOpacity={0.5} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ForecastTab({ data, channel }) {
  const pred = data?.predictions?.[channel];
  const ch = CHANNELS[channel];
  if (!pred?.summary) return <EmptyState message="No forecast data" />;

  const { summary } = pred;
  const slaColor = summary.overallSLA >= summary.target ? '#00e68a' : summary.overallSLA >= summary.target - 5 ? '#ffb020' : '#ff4757';

  return (
    <div className="animate-fade-up">
      <h2 style={styles.tabTitle}>{ch.icon} {ch.label} — Full Day Forecast</h2>
      <div style={styles.forecastHero}>
        <div style={styles.forecastMain}>
          <span style={styles.forecastLabel}>Projected Day-End SLA</span>
          <span style={{ ...styles.forecastValue, color: slaColor }}>{summary.overallSLA}%</span>
          <span style={{ ...styles.forecastGap, color: slaColor }}>
            {summary.gap > 0 ? '+' : ''}{summary.gap} pts {summary.meetingTarget ? '✓ ON TARGET' : '✗ BELOW TARGET'}
          </span>
        </div>
        <div style={styles.forecastStats}>
          <ForecastStat label="Current SLA" value={`${summary.currentSLA || '—'}%`} />
          <ForecastStat label="Weighted Avg" value={`${summary.weightedAvgSLA}%`} />
          <ForecastStat label="Trend" value={`${summary.trend} (${summary.trendStrength})`} color={summary.trend === 'declining' ? '#ff4757' : '#00e68a'} />
          <ForecastStat label="Best Hour" value={summary.bestHour ? `${summary.bestHour.hour}:00 (${summary.bestHour.sla}%)` : '—'} />
          <ForecastStat label="Worst Hour" value={summary.worstHour ? `${summary.worstHour.hour}:00 (${summary.worstHour.sla}%)` : '—'} />
          <ForecastStat label="Hours Remaining" value={summary.predictedHoursCount} />
        </div>
      </div>
      <div style={styles.chartCard}>
        <h3 style={styles.chartTitle}>Actual + Predicted SLA Timeline</h3>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={pred.hours.map(h => ({
            hour: `${String(h.hour).padStart(2, '0')}:00`,
            actual: h.type === 'actual' ? h.sla : null,
            predicted: h.type === 'predicted' ? h.sla : null,
            target: summary.target,
          }))} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="hour" tick={{ fill: '#4a5568', fontSize: 11 }} />
            <YAxis domain={[40, 100]} tick={{ fill: '#4a5568', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#111923', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, fontFamily: 'JetBrains Mono' }} />
            <ReferenceLine y={summary.target} stroke="#ff4757" strokeDasharray="5 5" />
            <Line type="monotone" dataKey="actual" stroke={ch.color} strokeWidth={2.5} dot={{ r: 4, fill: ch.color }} name="Actual" connectNulls={false} />
            <Line type="monotone" dataKey="predicted" stroke={ch.color} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3, fill: ch.color, strokeDasharray: '' }} name="Predicted" connectNulls={false} />
            <Line type="monotone" dataKey="target" stroke="#ff4757" strokeWidth={1} dot={false} name="Target" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {summary.risk && (
        <div style={{
          ...styles.riskBanner,
          borderColor: summary.risk.level === 'critical' ? '#ff4757' : summary.risk.level === 'high' ? '#ffb020' : '#00e68a',
          background: summary.risk.level === 'critical' ? 'var(--accent-red-dim)' : summary.risk.level === 'high' ? 'var(--accent-amber-dim)' : 'var(--accent-green-dim)',
        }}>
          <span style={styles.riskBannerIcon}>
            {summary.risk.level === 'critical' ? '🔴' : summary.risk.level === 'high' ? '🟡' : '🟢'}
          </span>
          <div>
            <strong style={{ textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>{summary.risk.level} Risk</strong>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>{summary.risk.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ForecastStat({ label, value, color }) {
  return (
    <div style={styles.forecastStatItem}>
      <span style={styles.forecastStatLabel}>{label}</span>
      <span style={{ ...styles.forecastStatValue, color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

function ActionsTab({ data }) {
  const [triggering, setTriggering] = useState(null);
  const [result, setResult] = useState(null);

  const trigger = async (type) => {
    setTriggering(type);
    setResult(null);
    try {
      const res = await fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      setResult({ success: true, type, data: json });
    } catch (err) {
      setResult({ success: false, type, error: err.message });
    }
    setTriggering(null);
  };

  return (
    <div className="animate-fade-up">
      <h2 style={styles.tabTitle}>⚡ Manual Actions</h2>
      <div style={styles.actionsGrid}>
        <ActionCard icon="🔄" title="Run Full System" desc="Trigger complete data refresh + prediction cycle" onClick={() => trigger('run')} loading={triggering === 'run'} color="var(--accent-cyan)" />
        <ActionCard icon="📧" title="Send Alert Email" desc="Dispatch SLA alert to distribution list" onClick={() => trigger('email')} loading={triggering === 'email'} color="var(--accent-purple)" />
        <ActionCard icon="💬" title="Send Chat Alert" desc="Post SLA summary to team chat" onClick={() => trigger('chat')} loading={triggering === 'chat'} color="var(--accent-green)" />
      </div>
      {result && (
        <div style={{ ...styles.resultBanner, borderColor: result.success ? '#00e68a' : '#ff4757' }}>
          {result.success ? `✓ ${result.type} triggered successfully` : `✗ Failed: ${result.error}`}
        </div>
      )}
      <div style={styles.systemInfo}>
        <h3 style={styles.chartTitle}>System Info</h3>
        <div style={styles.sysGrid}>
          <SysItem label="Prediction Engine" value="v2 — Client-Side" />
          <SysItem label="Data Source" value="Google Sheets via Apps Script" />
          <SysItem label="Refresh Interval" value="60 seconds" />
          <SysItem label="Channels" value="Chat, Email, Phone" />
          <SysItem label="Last Updated" value={data?.meta?.timestamp ? new Date(data.meta.timestamp).toLocaleString() : '—'} />
        </div>
      </div>
    </div>
  );
}

function ActionCard({ icon, title, desc, onClick, loading, color }) {
  return (
    <button onClick={onClick} disabled={loading} style={{ ...styles.actionCard, borderColor: loading ? color : 'var(--border-subtle)' }}>
      <span style={{ fontSize: '1.8rem' }}>{loading ? '⏳' : icon}</span>
      <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{title}</strong>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{desc}</span>
    </button>
  );
}

function SysItem({ label, value }) {
  return (
    <div style={styles.sysItem}>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)', flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 40, height: 40, border: '3px solid var(--border-default)', borderTopColor: '#00d4ff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>LOADING SLA ENGINE...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.3 }}>📊</div>
      <p>{message}</p>
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div style={{ background: 'var(--accent-red-dim)', border: '1px solid #ff4757', borderRadius: 10, padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <span>⚠️</span>
      <span style={{ flex: 1, fontSize: '0.9rem' }}>{message}</span>
      <button onClick={onRetry} style={{ ...styles.refreshBtn, fontSize: '0.8rem', padding: '4px 12px' }}>Retry</button>
    </div>
  );
}

const styles = {
  app: { minHeight: '100vh', maxWidth: 1400, margin: '0 auto', padding: '0 20px 40px' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid var(--border-subtle)', marginBottom: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  headerCenter: { display: 'flex', alignItems: 'center' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 16 },
  logoMark: { display: 'flex', alignItems: 'center', gap: 12 },
  logoIcon: { fontSize: '1.4rem', color: '#00d4ff' },
  logoText: { fontSize: '1rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-primary)' },
  logoSub: { fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' },
  healthPill: { display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 20, padding: '6px 16px' },
  healthDot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  healthLabel: { fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' },
  healthValue: { fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)' },
  timeBlock: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  timeValue: { fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.04em' },
  timeSub: { fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)' },
  refreshBtn: { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem', padding: '6px 10px', transition: 'all 0.2s' },
  nav: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', padding: '8px 0', marginBottom: 24, flexWrap: 'wrap', gap: 8 },
  navInner: { display: 'flex', gap: 2 },
  navTab: { position: 'relative', background: 'none', border: 'none', color: 'var(--text-muted)', padding: '10px 16px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500, fontFamily: 'var(--font-ui)', transition: 'color 0.2s', borderRadius: '6px 6px 0 0' },
  navTabActive: { color: '#00d4ff', background: 'rgba(0,212,255,0.06)' },
  navIndicator: { position: 'absolute', bottom: -1, left: '20%', right: '20%', height: 2, background: '#00d4ff', borderRadius: 1 },
  channelSelector: { display: 'flex', gap: 6 },
  channelBtn: { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-muted)', padding: '5px 12px', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'var(--font-ui)', transition: 'all 0.2s' },
  main: { minHeight: 400 },
  overviewGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 },
  channelCard: { background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '20px', opacity: 0 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardIcon: { fontSize: '1.2rem' },
  cardLabel: { fontWeight: 600, fontSize: '0.95rem', flex: 1 },
  healthBadge: { fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10, fontFamily: 'var(--font-mono)' },
  slaBlock: { marginBottom: 8 },
  slaValue: { fontSize: '2.2rem', fontWeight: 800, fontFamily: 'var(--font-mono)', lineHeight: 1 },
  slaTarget: { fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 6, fontFamily: 'var(--font-mono)' },
  sparkContainer: { margin: '8px 0 12px' },
  cardMeta: { display: 'flex', gap: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 },
  metaItem: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  metaLabel: { fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' },
  metaValue: { fontSize: '0.8rem', fontWeight: 600, fontFamily: 'var(--font-mono)', textTransform: 'capitalize' },
  recsPanel: { gridColumn: '1 / -1', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '20px', opacity: 0 },
  recsPanelTitle: { fontSize: '1rem', fontWeight: 700, marginBottom: 12, color: '#ffb020' },
  recCard: { background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 16px', marginBottom: 8 },
  recHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  recPriority: { fontSize: '0.65rem', fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' },
  recChannel: { fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' },
  recAction: { fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 },
  recReason: { fontSize: '0.78rem', color: 'var(--text-muted)' },
  tabTitle: { fontSize: '1.15rem', fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 },
  tableWrap: { background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' },
  th: { textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid var(--border-default)', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)', fontWeight: 500 },
  tr: { borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s' },
  td: { padding: '10px 16px', verticalAlign: 'middle' },
  mono: { fontFamily: 'var(--font-mono)' },
  typeBadge: { fontSize: '0.6rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' },
  confidenceBar: { position: 'relative', width: 80, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', display: 'inline-flex', alignItems: 'center' },
  confidenceFill: { position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 3 },
  confidenceText: { position: 'relative', zIndex: 1, fontSize: '0.6rem', marginLeft: 86, whiteSpace: 'nowrap', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' },
  riskDot: { width: 6, height: 6, borderRadius: '50%', display: 'inline-block', marginRight: 6 },
  chartGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 },
  chartCard: { background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '20px', marginBottom: 16 },
  chartTitle: { fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 16 },
  forecastHero: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 24, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '28px', marginBottom: 20 },
  forecastMain: { display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  forecastLabel: { fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)', marginBottom: 4 },
  forecastValue: { fontSize: '3.5rem', fontWeight: 800, fontFamily: 'var(--font-mono)', lineHeight: 1 },
  forecastGap: { fontSize: '0.85rem', fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: 8 },
  forecastStats: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 },
  forecastStatItem: { background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px', display: 'flex', flexDirection: 'column', gap: 4 },
  forecastStatLabel: { fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' },
  forecastStatValue: { fontSize: '0.85rem', fontWeight: 600, fontFamily: 'var(--font-mono)' },
  riskBanner: { display: 'flex', alignItems: 'flex-start', gap: 12, border: '1px solid', borderRadius: 'var(--radius-md)', padding: '16px 20px' },
  riskBannerIcon: { fontSize: '1.2rem', flexShrink: 0, marginTop: 2 },
  actionsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 },
  actionCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '28px 20px', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center', fontFamily: 'var(--font-ui)' },
  resultBanner: { border: '1px solid', borderRadius: 10, padding: '12px 20px', fontSize: '0.85rem', fontFamily: 'var(--font-mono)', marginBottom: 24 },
  systemInfo: { background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '20px' },
  sysGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 },
  sysItem: { display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px' },
};