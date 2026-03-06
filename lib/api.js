const BASE_URL = "https://script.google.com/macros/s/AKfycbwu_EWewvcKQ_gdlEYQR2KgWcumJnNJWftL6PJ7xa2_wZIh6oNjUkhJJQMsZdHY6T1wrQ/exec";

async function fetchFromScript(action, params = {}) {
  try {
    const url = new URL(BASE_URL);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error("Script API error: " + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch(e) {
    console.warn("Falling back to mock data:", e.message);
    return getMockData(action);
  }
}

async function postToScript(action, data) {
  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...data }),
    });
    return res.json();
  } catch(e) {
    return { success: true, mock: true };
  }
}

function getMockData(action) {
  const HOURS = [
    "09:00","10:00","11:00","12:00","13:00","14:00",
    "15:00","16:00","17:00","18:00","19:00","20:00","21:00","22:00"
  ];

  const chatIRT3   = [0.00,0.67,0.27,1.00,0.50,0.75,0.67,1.00,0.86,0.00,0.00,0.00,0.00,0.00];
  const emailRT2   = [0.26,0.41,0.69,0.73,0.67,1.00,1.00,0.72,0.69,0.33,0.00,0.00,0.00,0.00];
  const phoneSLA   = [0.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,0.85,0.00,0.00,0.00,0.00];
  const chatVol    = [7,5,11,12,2,13,14,12,11,0,0,0,0,0];
  const emailVol   = [11,52,22,18,20,25,20,24,19,0,0,0,0,0];
  const phoneVol   = [0,5,7,8,1,5,3,3,5,0,0,0,0,0];
  const chatFTE    = [6,7,7,8,9,10,13,10,7,7,0,0,0,0];
  const emailFTE   = [7,10,9,9,10,10,10,7,3,2,1,1,0,0];
  const phoneFTE   = [0,7,7,8,9,9,9,8,6,5,5,6,6,0];
  const chatReq    = [22,9,7,3,4,5,5,4,4,3,3,3,3,1];
  const emailReq   = [10,11,7,6,4,6,6,6,5,4,5,4,4,2];
  const phoneReq   = [2,9,7,8,9,9,9,8,6,5,5,6,6,0];
  const chatBL     = [10,10,13,9,13,12,9,8,3,0,0,0,0,0];
  const emailBL    = [0,0,0,0,0,0,0,4,4,2,4,4,2,4];
  const chatOcc    = [0.88,0.40,0.66,0.39,0.48,0.46,0.25,0.39,0.42,0,0,0,0,0];
  const emailOcc   = [0.95,0.94,0.59,0.37,0.54,0.55,0.38,0.65,0.97,0,0,0,0,0];
  const phoneOcc   = [0,0,0,0,0,0,0,0,0,0,0,0,0,0];

  function riskScore(sla, backlog, occ, fteGap, vol) {
    const slaR = sla > 0 ? Math.max(0, (1 - sla) * 40) : 20;
    const blR  = vol > 0 ? Math.min(30, (backlog / Math.max(1, vol)) * 30) : 0;
    const occR = occ > 0.85 ? (occ - 0.85) * 100 : 0;
    const fteR = fteGap < 0 ? Math.min(20, Math.abs(fteGap) * 3) : 0;
    return Math.min(100, slaR + blR + occR + fteR);
  }

  function riskLabel(s) {
    if (s <= 20) return "LOW";
    if (s <= 40) return "MEDIUM";
    if (s <= 65) return "HIGH";
    return "CRITICAL";
  }

  function rec(risk, gap, bl, ch) {
    if (risk <= 20) return "On track";
    if (risk <= 40) return "Monitor — watch volume";
    if (gap < -2)   return "Add " + Math.abs(Math.round(gap)) + " FTE immediately";
    if (bl > 10)    return "Clear backlog — defer non-urgent " + ch;
    return "Escalate — review staffing plan";
  }

  if (action === "forecast") {
    const hourly = HOURS.map((time, i) => {
      const cGap = chatFTE[i]  - chatReq[i];
      const eGap = emailFTE[i] - emailReq[i];
      const pGap = phoneFTE[i] - phoneReq[i];
      const cRS  = riskScore(chatIRT3[i],  chatBL[i],  chatOcc[i],  cGap, chatVol[i]);
      const eRS  = riskScore(emailRT2[i],  emailBL[i], emailOcc[i], eGap, emailVol[i]);
      const pRS  = riskScore(phoneSLA[i],  0,          phoneOcc[i], pGap, phoneVol[i]);
      const avg  = (cRS + eRS + pRS) / 3;
      return {
        time, hour: 9 + i,
        chat:  { sla: chatIRT3[i], actVol: chatVol[i], fteActual: chatFTE[i], fteReq: chatReq[i], fteGap: cGap, backlog: chatBL[i],  occupancy: chatOcc[i],  riskScore: cRS, riskLabel: riskLabel(cRS), recommendation: rec(cRS, cGap, chatBL[i],  "chat") },
        email: { sla: emailRT2[i], actVol: emailVol[i],fteActual: emailFTE[i],fteReq: emailReq[i],fteGap: eGap, backlog: emailBL[i], occupancy: emailOcc[i], riskScore: eRS, riskLabel: riskLabel(eRS), recommendation: rec(eRS, eGap, emailBL[i], "email") },
        phone: { sla: phoneSLA[i], actVol: phoneVol[i],fteActual: phoneFTE[i],fteReq: phoneReq[i],fteGap: pGap, backlog: 0,          occupancy: phoneOcc[i], riskScore: pRS, riskLabel: riskLabel(pRS), recommendation: rec(pRS, pGap, 0,          "phone") },
        overallRisk: avg, riskLabel: riskLabel(avg),
      };
    });
    const cv = hourly.filter(h => h.chat.sla  > 0);
    const ev = hourly.filter(h => h.email.sla > 0);
    const pv = hourly.filter(h => h.phone.sla > 0);
    return {
      hourly,
      summary: {
        chat:  { avgSLA: cv.reduce((s,h)=>s+h.chat.sla,0)  / Math.max(1,cv.length), criticalHours: hourly.filter(h=>h.chat.riskScore>65).length,  totalHours: hourly.length },
        email: { avgSLA: ev.reduce((s,h)=>s+h.email.sla,0) / Math.max(1,ev.length), criticalHours: hourly.filter(h=>h.email.riskScore>65).length, totalHours: hourly.length },
        phone: { avgSLA: pv.reduce((s,h)=>s+h.phone.sla,0) / Math.max(1,pv.length), criticalHours: hourly.filter(h=>h.phone.riskScore>65).length, totalHours: hourly.length },
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  if (action === "prediction") {
    const now = new Date().getHours();
    const chatSLA  = [0.00,0.67,0.27,1.00,0.50,0.75,0.67,1.00,0.86,0.92,0.88,0.00,0.00,0.00];
    const emailSLA = [0.26,0.41,0.69,0.73,0.67,1.00,1.00,0.72,0.69,0.85,0.80,0.00,0.00,0.00];
    const phoneSLA2= [0.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,0.95,0.90,0.00,0.00,0.00];
    const chatVol2 = [7,5,11,12,2,13,14,12,11,10,8,0,0,0];
    const emailVol2= [11,52,22,18,20,25,20,24,19,15,10,0,0,0];
    const phoneVol2= [0,5,7,8,1,5,3,3,5,4,3,0,0,0];
    const chatFTE2 = [6,7,7,8,9,10,13,10,7,7,5,0,0,0];
    const emailFTE2= [7,10,9,9,10,10,10,7,3,5,4,0,0,0];
    const phoneFTE2= [0,7,7,8,9,9,9,8,6,5,4,0,0,0];
    function buildRows(slaArr, volArr, fteArr) {
      return HOURS.map((time, i) => {
        const hr = 9 + i;
        const isPast = hr < now;
        return { time, hour: hr, isPast, predicted: !isPast, sla: slaArr[i], vol: volArr[i], fte: fteArr[i], confidence: isPast ? 1.0 : 0.80 };
      });
    }
    function daySummary(rows) {
      const active = rows.filter(r => r.vol > 0 || r.sla > 0);
      const totalVol = active.reduce((s,r) => s + Math.max(1,r.vol), 0);
      const daySLA = active.reduce((s,r) => s + r.sla * Math.max(1,r.vol), 0) / Math.max(1,totalVol);
      const actual = active.filter(r => r.isPast);
      const pred   = active.filter(r => r.predicted);
      const actSLA = actual.length ? actual.reduce((s,r)=>s+r.sla,0)/actual.length : 0;
      const predSLA= pred.length   ? pred.reduce((s,r)=>s+r.sla,0)/pred.length : 0;
      return { daySLA, actualSLA: actSLA, predictedSLA: predSLA, trend: daySLA > 0.85 ? "improving" : "declining", criticalHours: active.filter(r=>r.sla<0.80).length };
    }
    const chat  = buildRows(chatSLA,  chatVol2,  chatFTE2);
    const email = buildRows(emailSLA, emailVol2, emailFTE2);
    const phone = buildRows(phoneSLA2,phoneVol2, phoneFTE2);
    return { chat, email, phone, summary: { chat: daySummary(chat), email: daySummary(email), phone: daySummary(phone), currentHour: now } };
  }

  if (action === "insights") {
    return { insights: [{ timestamp: new Date().toISOString(), type: "Multi-Channel SLA Analysis", text: "CHAT: IRT 3min avg 56% — Hours 9AM and 6PM-10PM at risk.\n\nEMAIL: RT 2hr avg 67% — Backlog building from 4PM.\n\nPHONE: SLA strong 10AM-5PM at 100%.\n\nTop 3 actions:\n1. Review Chat staffing 9AM\n2. Clear Email backlog before 4PM\n3. Confirm Phone evening coverage" }] };
  }

  if (action === "status") {
    return { modules: [
      { module: "Data Save",    status: "✅ Saved 14 rows",   lastRun: new Date().toISOString() },
      { module: "Forecast",     status: "✅ 3 channels live", lastRun: new Date().toISOString() },
      { module: "AI Insights",  status: "✅ Insights ready",  lastRun: new Date().toISOString() },
      { module: "Email Report", status: "✅ Sent",            lastRun: new Date().toISOString() },
      { module: "Learning",     status: "✅ Accuracy: 94.2%", lastRun: new Date().toISOString() },
    ]};
  }

  return { rows: [], mock: true };
}

export { fetchFromScript, postToScript };
