export function transformForecastData(raw) {
    if (!raw || raw.error) return null;
    const channels = { chat: [], email: [], phone: [] };
  
    if (raw.hourly && Array.isArray(raw.hourly)) {
      for (const entry of raw.hourly) {
        const hour = entry.hour || 0;
        if (entry.chat) channels.chat.push(parseEntry(entry.chat, hour));
        if (entry.email) channels.email.push(parseEntry(entry.email, hour));
        if (entry.phone) channels.phone.push(parseEntry(entry.phone, hour));
      }
    } else if (raw.chat || raw.email || raw.phone) {
      if (raw.chat && Array.isArray(raw.chat)) channels.chat = raw.chat.map((r, i) => parseEntry(r, r.hour || 9 + i));
      if (raw.email && Array.isArray(raw.email)) channels.email = raw.email.map((r, i) => parseEntry(r, r.hour || 9 + i));
      if (raw.phone && Array.isArray(raw.phone)) channels.phone = raw.phone.map((r, i) => parseEntry(r, r.hour || 9 + i));
    }
    return channels;
  }
  
  function parseEntry(data, hour) {
    let sla = parseFloat(data.sla || data.slaPercent || data.SLA || 0);
    if (sla > 0 && sla <= 1) sla = sla * 100;
  
    return {
      hour: hour,
      sla: Math.round(sla * 10) / 10,
      volume: parseInt(data.actVol || data.volume || data.offered || data.contacts || 0),
      fte: parseFloat(data.fteActual || data.fte || data.staffed || data.agents || 0),
      fteNeeded: parseFloat(data.fteReq || data.fteNeeded || data.required || 0),
      fteScheduled: parseFloat(data.schedFTE || data.fteScheduled || data.ftePlan || 0),
      backlog: parseInt(data.backlog || data.queue || data.pending || 0),
      occupancy: parseFloat(data.occupancy || data.occ || 0),
      aht: parseFloat(data.aht || data.handleTime || data.ABT || 0),
      concurrency: parseFloat(data.concurrency || 0),
      utilization: parseFloat(data.utilization || 0),
      shrinkage: parseFloat(data.shrinkage || data.unplannedShrinkage || 0),
      midFCVol: parseFloat(data.midFCVol || 0),
    };
  }
  
  export function calculateHealthScore(channelPrediction) {
    if (!channelPrediction?.summary) return 0;
    const { summary } = channelPrediction;
    let score = 100;
    if (summary.gap < 0) score -= Math.min(40, Math.abs(summary.gap) * 3);
    if (summary.trend === 'declining') score -= summary.trendStrength === 'strong' ? 20 : 10;
    const riskPenalty = { critical: 25, high: 15, medium: 8, low: 0 };
    score -= riskPenalty[summary.risk.level] || 0;
    return Math.max(0, Math.min(100, Math.round(score)));
  }