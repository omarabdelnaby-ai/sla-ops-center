import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from "recharts";

const pct = (v) => v > 0 ? (v * 100).toFixed(0) + "%" : "—";
const num = (v) => typeof v === "number" ? v.toFixed(1) : "—";

const RISK = {
  LOW:      { color: "#00ff88", bg: "rgba(0,255,136,0.08)" },
  MEDIUM:   { color: "#fbbf24", bg: "rgba(251,191,36,0.08)" },
  HIGH:     { color: "#ff7c2a", bg: "rgba(255,124,42,0.08)" },
  CRITICAL: { color: "#ff4444", bg: "rgba(255,68,68,0.08)" },
};

const CHANNELS = [
  { key: "chat",  label: "CHAT",  slaLabel: "IRT 3MIN%", color: "#00d4ff", target: 0.80 },
  { key: "email", label: "EMAIL", slaLabel: "RT 2HR%",   color: "#7c3aed", target: 0.80 },
  { key: "phone", label: "PHONE", slaLabel: "SLA%",      color: "#00ff88", target: 0.95 },
];

function risk(label) { return RISK[label] || RISK.MEDIUM; }

function KpiCard({ label, value, sub, color, delay = 0 }) {
  return (
    <div style={{
      background: "#0d1117", borderTop: "2px solid " + color,
      border: "1px solid #1e2733", padding: "16px 20px",
      animation: "fadeIn 0.4s ease " + delay + "ms forwards", opacity: 0,
    }}>
      <div style={{ fontSize: 10, letterSpacing: "0.15em", color: "#64748b", fontFamily: "Space Mono,monospace", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color, fontFamily: "Syne,sans-serif", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, fontFamily: "Space Mono,monospace" }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ title, accent }) {
  accent = accent || "#00d4ff";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <div style={{ width: 3, height: 18, background: accent, borderRadius: 2 }} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: "#94a3b8", fontFamily: "Space Mono,monospace" }}>{title}</span>
    </div>
  );
}

function RiskBadge({ label }) {
  var r = risk(label);
  return (
    <span style={{ color: r.color, background: r.bg, padding: "2px 8px", fontSize: 10, fontFamily: "Space Mono,monospace", letterSpacing: "0.1em" }}>
      {label || "—"}
    </span>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: "#0d1117", border: "1px solid #2a3544", padding: "10px 14px", fontFamily: "Space Mono,monospace", fontSize: 11 }}>
      <div style={{ color: "#64748b", marginBottom: 6 }}>{label}</div>
      {payload.map(function(p, i) {
        return (
          <div key={i} style={{ color: p.color, marginBottom: 2 }}>
            {p.name}: {typeof p.value === "number" && p.value <= 1 ? pct(p.value) : p.value}
          </div>
        );
      })}
    </div>
  );
}

function btnStyle(bg, color) {
  return {
    background: bg, color: color, border: "1px solid " + color,
    padding: "6px 14px", fontFamily: "Space Mono,monospace",
    fontSize: 10, letterSpacing: "0.1em", cursor: "pointer",
  };
}

export default function Dashboard() {
  var [tab, setTab]                 = useState("overview");
  var [channel, setChannel]         = useState("chat");
  var [data, setData]               = useState(null);
  var [insights, setInsights]       = useState(null);
  var [status, setStatus]           = useState(null);
  var [loading, setLoading]         = useState(true);
  var [trigger, setTrigger]         = useState(null);
  var [lastRefresh, setLastRefresh] = useState(null);

  var load = useCallback(async function() {
    setLoading(true);
    try {
      var results = await Promise.all([
        fetch("/api/forecast").then(function(r) { return r.json(); }),
        fetch("/api/insights").then(function(r) { return r.json(); }),
        fetch("/api/status").then(function(r) { return r.json(); }),
      ]);
      setData(results[0]);
      setInsights(results[1]);
      setStatus(results[2]);
      setLastRefresh(new Date());
    } catch(e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(function() { load(); }, [load]);

  async function handleTrigger(type, msg) {
    msg = msg || "";
    setTrigger(type);
    await fetch("/api/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type, message: msg }),
    });
    setTrigger(null);
    load();
  }

  var hourly  = (data && data.hourly)  ? data.hourly  : [];
  var summary = (data && data.summary) ? data.summary : {};

  var chartData = hourly.map(function(h) {
    return {
      hour:        h.time || h.hour,
      chatSLA:     h.chat  ? h.chat.sla      : 0,
      emailSLA:    h.email ? h.email.sla     : 0,
      phoneSLA:    h.phone ? h.phone.sla     : 0,
      chatFTE:     h.chat  ? h.chat.fteActual  : 0,
      emailFTE:    h.email ? h.email.fteActual : 0,
      phoneFTE:    h.phone ? h.phone.fteActual : 0,
      chatVol:     h.chat  ? h.chat.actVol   : 0,
      emailVol:    h.email ? h.email.actVol  : 0,
      phoneVol:    h.phone ? h.phone.actVol  : 0,
      chatBacklog: h.chat  ? h.chat.backlog  : 0,
      emailBacklog:h.email ? h.email.backlog : 0,
    };
  });

  return (
    <div style={{ minHeight: "100vh", background: "#080c10" }}>

      <header style={{
        borderBottom: "1px solid #1e2733", padding: "0 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 60, position: "sticky", top: 0, zIndex: 100,
        background: "rgba(8,12,16,0.97)", backdropFilter: "blur(10px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 8px #00ff88", animation: "pulse 2s infinite" }} />
          <span style={{ fontFamily: "Syne,sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: "0.06em" }}>SLA OPS CENTER</span>
          <span style={{ fontFamily: "Space Mono,monospace", fontSize: 9, color: "#2a3544", letterSpacing: "0.2em" }}>3 CHANNELS / LIVE</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastRefresh && (
            <span style={{ fontFamily: "Space Mono,monospace", fontSize: 9, color: "#2a3544" }}>
              SYNC {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button onClick={load} style={btnStyle("#1e2733", "#64748b")}>⟳</button>
          <button onClick={function(){handleTrigger("run");}} disabled={!!trigger} style={btnStyle("#00d4ff18","#00d4ff")}>{trigger==="run"?"⏳":"▶ RUN"}</button>
          <button onClick={function(){handleTrigger("email");}} disabled={!!trigger} style={btnStyle("#7c3aed18","#7c3aed")}>{trigger==="email"?"⏳":"✉ EMAIL"}</button>
          <button onClick={function(){handleTrigger("chat","SLA update");}} disabled={!!trigger} style={btnStyle("#00ff8818","#00ff88")}>{trigger==="chat"?"⏳":"💬 CHAT"}</button>
        </div>
      </header>

      <main style={{ padding: "24px 28px", maxWidth: 1440, margin: "0 auto" }}>
        {loading ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:400, fontFamily:"Space Mono,monospace", color:"#2a3544", letterSpacing:"0.2em" }}>
            LOADING 3 CHANNELS...
          </div>
        ) : (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:12, marginBottom:24 }}>
              <KpiCard label="CHAT IRT 3MIN"  value={pct(summary.chat  && summary.chat.avgSLA)}  color="#00d4ff" delay={0}   sub={(summary.chat  && summary.chat.criticalHours  || 0)+" critical hrs"} />
              <KpiCard label="CHAT CRITICAL"  value={summary.chat  && summary.chat.criticalHours  || 0} color="#ff4444" delay={50}  sub="hours at risk" />
              <KpiCard label="EMAIL RT 2HR"   value={pct(summary.email && summary.email.avgSLA)} color="#7c3aed" delay={100} sub={(summary.email && summary.email.criticalHours || 0)+" critical hrs"} />
              <KpiCard label="EMAIL CRITICAL" value={summary.email && summary.email.criticalHours || 0} color="#ff4444" delay={150} sub="hours at risk" />
              <KpiCard label="PHONE SLA"      value={pct(summary.phone && summary.phone.avgSLA)} color="#00ff88" delay={200} sub={(summary.phone && summary.phone.criticalHours || 0)+" critical hrs"} />
              <KpiCard label="PHONE CRITICAL" value={summary.phone && summary.phone.criticalHours || 0} color="#ff4444" delay={250} sub="hours at risk" />
              <KpiCard label="TOTAL HOURS"    value={hourly.length} color="#64748b" delay={300} sub="in forecast" />
            </div>

            <div style={{ display:"flex", gap:2, marginBottom:20, borderBottom:"1px solid #1e2733" }}>
              {[["overview","📊 OVERVIEW"],["detail","🔍 HOURLY DETAIL"],["charts","📈 CHARTS"],["insights","🤖 AI INSIGHTS"],["status","🖥 STATUS"]].map(function(item) {
                return (
                  <button key={item[0]} onClick={function(){setTab(item[0]);}} style={{
                    background: tab===item[0] ? "#0d1117" : "transparent", border:"none",
                    borderBottom: tab===item[0] ? "2px solid #00d4ff" : "2px solid transparent",
                    color: tab===item[0] ? "#00d4ff" : "#64748b", padding:"8px 18px",
                    fontFamily:"Space Mono,monospace", fontSize:10, letterSpacing:"0.12em", cursor:"pointer",
                  }}>{item[1]}</button>
                );
              })}
            </div>

            {tab === "overview" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
                {CHANNELS.map(function(ch) {
                  var rows       = hourly.map(function(h){ return h[ch.key]; }).filter(Boolean);
                  var activeRows = rows.filter(function(r){ return r.actVol > 0; });
                  var avgSLA     = activeRows.length ? activeRows.reduce(function(s,r){return s+r.sla;},0)/activeRows.length : 0;
                  var critical   = rows.filter(function(r){return r.riskScore>65;}).length;
                  var totalGap   = rows.reduce(function(s,r){return s+(r.fteGap||0);},0);
                  var occRows    = rows.filter(function(r){return r.occupancy>0;});
                  var avgOcc     = occRows.length ? occRows.reduce(function(s,r){return s+r.occupancy;},0)/occRows.length : 0;
                  var totalVol   = rows.reduce(function(s,r){return s+(r.actVol||0);},0);

                  return (
                    <div key={ch.key} style={{ background:"#0d1117", border:"1px solid #1e2733", borderTop:"3px solid "+ch.color, padding:20 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                        <span style={{ fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:18, color:ch.color }}>{ch.label}</span>
                        <span style={{ fontFamily:"Space Mono,monospace", fontSize:9, color:"#64748b" }}>{ch.slaLabel}</span>
                      </div>
                      <div style={{ fontSize:36, fontWeight:800, color: avgSLA>=ch.target?"#00ff88":"#ff4444", fontFamily:"Syne,sans-serif", marginBottom:4 }}>
                        {pct(avgSLA)}
                      </div>
                      <div style={{ fontFamily:"Space Mono,monospace", fontSize:10, color:"#64748b", marginBottom:16 }}>AVG SLA (ACTIVE HOURS)</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
                        {[
                          ["CRITICAL HRS", critical,            critical>0?"#ff4444":"#00ff88"],
                          ["FTE GAP",      totalGap.toFixed(1), totalGap<0?"#ff4444":"#00ff88"],
                          ["TOTAL VOL",    totalVol,            "#94a3b8"],
                          ["AVG OCC",      pct(avgOcc),         "#94a3b8"],
                        ].map(function(item) {
                          return (
                            <div key={item[0]} style={{ background:"#080c10", padding:"8px 10px" }}>
                              <div style={{ fontSize:9, color:"#64748b", fontFamily:"Space Mono,monospace", letterSpacing:"0.1em" }}>{item[0]}</div>
                              <div style={{ fontSize:16, fontWeight:700, color:item[2], fontFamily:"Syne,sans-serif" }}>{item[1]}</div>
                            </div>
                          );
                        })}
                      </div>
                      <ResponsiveContainer width="100%" height={80}>
                        <LineChart data={chartData}>
                          <Line type="monotone" dataKey={ch.key+"SLA"} stroke={ch.color} strokeWidth={2} dot={false} />
                          <ReferenceLine y={ch.target} stroke={ch.color} strokeDasharray="3 3" strokeOpacity={0.4} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "detail" && (
              <div>
                <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                  {CHANNELS.map(function(ch) {
                    return (
                      <button key={ch.key} onClick={function(){setChannel(ch.key);}} style={{
                        background: channel===ch.key ? ch.color+"22" : "transparent",
                        border: "1px solid "+(channel===ch.key ? ch.color : "#2a3544"),
                        color: channel===ch.key ? ch.color : "#64748b",
                        padding:"6px 16px", fontFamily:"Space Mono,monospace",
                        fontSize:10, letterSpacing:"0.1em", cursor:"pointer",
                      }}>{ch.label}</button>
                    );
                  })}
                </div>
                <div style={{ background:"#0d1117", border:"1px solid #1e2733", padding:20 }}>
                  <SectionHeader
                    title={CHANNELS.find(function(c){return c.key===channel;}).label + " — HOURLY BREAKDOWN"}
                    accent={CHANNELS.find(function(c){return c.key===channel;}).color}
                  />
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:"Space Mono,monospace", fontSize:11 }}>
                      <thead>
                        <tr style={{ background:"#080c10" }}>
                          {["TIME","SLA","RISK","ACT VOL","FTE ACT","FTE REQ","FTE GAP","BACKLOG","OCCUPANCY","RECOMMENDATION"].map(function(h) {
                            return <th key={h} style={{ padding:"10px 12px", textAlign:"left", color:"#64748b", fontSize:9, letterSpacing:"0.1em", borderBottom:"1px solid #1e2733" }}>{h}</th>;
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {hourly.map(function(row, i) {
                          var ch   = row[channel] || {};
                          var rl   = risk(ch.riskLabel);
                          var chConf = CHANNELS.find(function(c){return c.key===channel;});
                          return (
                            <tr key={i} style={{ borderBottom:"1px solid rgba(30,39,51,0.5)" }}>
                              <td style={{ padding:"9px 12px", color:chConf.color, fontWeight:700 }}>{row.time}</td>
                              <td style={{ padding:"9px 12px" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                  <div style={{ width:32, height:3, background:"#1e2733", borderRadius:2 }}>
                                    <div style={{ width:((ch.sla||0)*100)+"%", height:"100%", background:rl.color, borderRadius:2 }} />
                                  </div>
                                  <span style={{ color:rl.color, fontWeight:700 }}>{pct(ch.sla)}</span>
                                </div>
                              </td>
                              <td style={{ padding:"9px 12px" }}><RiskBadge label={ch.riskLabel} /></td>
                              <td style={{ padding:"9px 12px", color:"#e2e8f0" }}>{ch.actVol||0}</td>
                              <td style={{ padding:"9px 12px", color:"#e2e8f0" }}>{ch.fteActual||0}</td>
                              <td style={{ padding:"9px 12px", color:"#e2e8f0" }}>{ch.fteReq||0}</td>
                              <td style={{ padding:"9px 12px", color:(ch.fteGap||0)<0?"#ff4444":"#00ff88", fontWeight:700 }}>
                                {(ch.fteGap||0)>0?"+":""}{num(ch.fteGap)}
                              </td>
                              <td style={{ padding:"9px 12px", color:(ch.backlog||0)>5?"#ff7c2a":"#94a3b8" }}>{ch.backlog||0}</td>
                              <td style={{ padding:"9px 12px", color:"#94a3b8" }}>{pct(ch.occupancy)}</td>
                              <td style={{ padding:"9px 12px", color:"#64748b", maxWidth:200 }}>{ch.recommendation||"—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {tab === "charts" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
                <div style={{ background:"#0d1117", border:"1px solid #1e2733", padding:20 }}>
                  <SectionHeader title="SLA % — ALL CHANNELS" />
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2733" />
                      <XAxis dataKey="hour" stroke="#2a3544" tick={{ fontFamily:"Space Mono", fontSize:9, fill:"#64748b" }} />
                      <YAxis domain={[0,1]} tickFormatter={function(v){return (v*100).toFixed(0)+"%";}} stroke="#2a3544" tick={{ fontFamily:"Space Mono", fontSize:9, fill:"#64748b" }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontFamily:"Space Mono", fontSize:10 }} />
                      <ReferenceLine y={0.80} stroke="#fbbf24" strokeDasharray="3 3" />
                      <ReferenceLine y={0.95} stroke="#00ff88" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="chatSLA"  stroke="#00d4ff" strokeWidth={2} dot={false} name="Chat IRT3" />
                      <Line type="monotone" dataKey="emailSLA" stroke="#7c3aed" strokeWidth={2} dot={false} name="Email RT2H" />
                      <Line type="monotone" dataKey="phoneSLA" stroke="#00ff88" strokeWidth={2} dot={false} name="Phone SLA" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ background:"#0d1117", border:"1px solid #1e2733", padding:20 }}>
                  <SectionHeader title="FTE ACTUAL — ALL CHANNELS" accent="#7c3aed" />
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2733" />
                      <XAxis dataKey="hour" stroke="#2a3544" tick={{ fontFamily:"Space Mono", fontSize:9, fill:"#64748b" }} />
                      <YAxis stroke="#2a3544" tick={{ fontFamily:"Space Mono", fontSize:9, fill:"#64748b" }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontFamily:"Space Mono", fontSize:10 }} />
                      <Bar dataKey="chatFTE"  fill="#00d4ff" fillOpacity={0.7} name="Chat"  radius={[2,2,0,0]} />
                      <Bar dataKey="emailFTE" fill="#7c3aed" fillOpacity={0.7} name="Email" radius={[2,2,0,0]} />
                      <Bar dataKey="phoneFTE" fill="#00ff88" fillOpacity={0.7} name="Phone" radius={[2,2,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ background:"#0d1117", border:"1px solid #1e2733", padding:20 }}>
                  <SectionHeader title="VOLUME — ALL CHANNELS" accent="#ff7c2a" />
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2733" />
                      <XAxis dataKey="hour" stroke="#2a3544" tick={{ fontFamily:"Space Mono", fontSize:9, fill:"#64748b" }} />
                      <YAxis stroke="#2a3544" tick={{ fontFamily:"Space Mono", fontSize:9, fill:"#64748b" }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontFamily:"Space Mono", fontSize:10 }} />
                      <Bar dataKey="chatVol"  fill="#00d4ff" fillOpacity={0.7} name="Chat"  radius={[2,2,0,0]} />
                      <Bar dataKey="emailVol" fill="#7c3aed" fillOpacity={0.7} name="Email" radius={[2,2,0,0]} />
                      <Bar dataKey="phoneVol" fill="#00ff88" fillOpacity={0.7} name="Phone" radius={[2,2,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ background:"#0d1117", border:"1px solid #1e2733", padding:20 }}>
                  <SectionHeader title="BACKLOG — CHAT & EMAIL" accent="#ff4444" />
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2733" />
                      <XAxis dataKey="hour" stroke="#2a3544" tick={{ fontFamily:"Space Mono", fontSize:9, fill:"#64748b" }} />
                      <YAxis stroke="#2a3544" tick={{ fontFamily:"Space Mono", fontSize:9, fill:"#64748b" }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontFamily:"Space Mono", fontSize:10 }} />
                      <Bar dataKey="chatBacklog"  fill="#00d4ff" fillOpacity={0.7} name="Chat"  radius={[2,2,0,0]} />
                      <Bar dataKey="emailBacklog" fill="#7c3aed" fillOpacity={0.7} name="Email" radius={[2,2,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {tab === "insights" && (
              <div style={{ display:"grid", gap:16 }}>
                <SectionHeader title="AI INSIGHTS — GEMINI MULTI-CHANNEL ANALYSIS" accent="#7c3aed" />
                {(!insights || !insights.insights || insights.insights.length === 0) ? (
                  <div style={{ color:"#2a3544", fontFamily:"Space Mono,monospace", fontSize:12, padding:32 }}>
                    NO INSIGHTS YET — RUN FULL SYSTEM FIRST
                  </div>
                ) : (
                  insights.insights.map(function(ins, i) {
                    return (
                      <div key={i} style={{ background:"#0d1117", border:"1px solid #1e2733", borderLeft:"3px solid #7c3aed", padding:24 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
                          <span style={{ fontFamily:"Space Mono,monospace", fontSize:10, color:"#7c3aed", letterSpacing:"0.15em" }}>{ins.type ? ins.type.toUpperCase() : ""}</span>
                          <span style={{ fontFamily:"Space Mono,monospace", fontSize:10, color:"#2a3544" }}>{new Date(ins.timestamp).toLocaleString()}</span>
                        </div>
                        <pre style={{ fontFamily:"Space Mono,monospace", fontSize:12, color:"#94a3b8", lineHeight:1.9, whiteSpace:"pre-wrap" }}>{ins.text}</pre>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === "status" && (
              <div>
                <SectionHeader title="SYSTEM MODULE STATUS" />
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:12, marginBottom:24 }}>
                  {(status && status.modules ? status.modules : []).map(function(m, i) {
                    var ok  = m.status && m.status.includes("✅");
                    var err = m.status && m.status.includes("❌");
                    var col = ok ? "#00ff88" : err ? "#ff4444" : "#fbbf24";
                    return (
                      <div key={i} style={{ background:"#0d1117", border:"1px solid #1e2733", borderLeft:"3px solid "+col, padding:18 }}>
                        <div style={{ fontFamily:"Space Mono,monospace", fontSize:9, color:"#64748b", letterSpacing:"0.12em", marginBottom:6 }}>{m.module ? m.module.toUpperCase() : ""}</div>
                        <div style={{ fontFamily:"Space Mono,monospace", fontSize:12, color:col }}>{m.status}</div>
                        {m.lastRun && <div style={{ fontFamily:"Space Mono,monospace", fontSize:9, color:"#2a3544", marginTop:4 }}>{new Date(m.lastRun).toLocaleTimeString()}</div>}
                      </div>
                    );
                  })}
                </div>
                <div style={{ background:"#0d1117", border:"1px solid #1e2733", padding:20 }}>
                  <SectionHeader title="MANUAL TRIGGERS" accent="#ff7c2a" />
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                    {[["run","▶ RUN FULL SYSTEM","#00d4ff"],["email","✉ SEND EMAIL","#7c3aed"],["chat","💬 SEND CHAT","#00ff88"]].map(function(item) {
                      return (
                        <button key={item[0]} onClick={function(){handleTrigger(item[0]);}} disabled={!!trigger} style={{
                          background: item[2]+"18", color: item[2], border: "1px solid "+item[2],
                          padding:"10px 18px", fontFamily:"Space Mono,monospace",
                          fontSize:10, letterSpacing:"0.12em", cursor:"pointer", fontWeight:700,
                        }}>{trigger===item[0] ? "⏳ ..." : item[1]}</button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}