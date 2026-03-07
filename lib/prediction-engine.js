const CONFIG = {
    SLA_TARGETS: { chat: 70, email: 90, phone: 80 },
    OPERATING_HOURS: { start: 9, end: 22 },
    RECENCY_WEIGHTS: [0.05, 0.08, 0.12, 0.15, 0.20, 0.40],
    VOLUME_SLA_SENSITIVITY: { chat: 2.5, email: 1.8, phone: 3.0 },
    FTE_GAP_SLA_IMPACT: { chat: 3.0, email: 2.0, phone: 4.0 },
    SLA_CEILING: { chat: 96, email: 98, phone: 94 },
    SLA_FLOOR: { chat: 40, email: 45, phone: 35 },
  };
  
  export function predictChannel(hourlyData, channel) {
    if (!hourlyData || hourlyData.length === 0) return { error: 'No data', hours: [], summary: null };
  
    const target = CONFIG.SLA_TARGETS[channel] || 80;
    const actualHours = hourlyData.filter(h => h.sla != null && h.sla > 0);
    const allDataHours = hourlyData.filter(h => h.volume > 0 || h.fte > 0 || h.fteNeeded > 0 || h.fteScheduled > 0 || h.midFCVol > 0);
    const totalSlots = CONFIG.OPERATING_HOURS.end - CONFIG.OPERATING_HOURS.start;
    const remainingCount = totalSlots - Math.max(actualHours.length, allDataHours.length);
  
    if (actualHours.length === 0) return predictFromForecastOnly(hourlyData, channel, target);
  
    const trend = calculateTrend(actualHours);
    const weightedAvg = calculateWeightedAverage(actualHours.map(h => h.sla));
  
    const predictedHours = [];
    let lastKnownSLA = actualHours[actualHours.length - 1].sla;
    let cumVol = actualHours.reduce((s, h) => s + (h.volume || 0), 0);
    let cumHandled = actualHours.reduce((s, h) => s + (h.volume || 0) * (h.sla || 0) / 100, 0);
  
    for (let i = 0; i < Math.max(0, remainingCount); i++) {
      const hour = CONFIG.OPERATING_HOURS.start + actualHours.length + i;
      if (hour >= CONFIG.OPERATING_HOURS.end) break;
      const matchingData = hourlyData.find(h => h.hour === hour) || {};
      const prediction = predictSingleHour({ hour, channel, lastSLA: lastKnownSLA, trend, weightedAvg, hoursAhead: i + 1, lastHourData: actualHours[actualHours.length - 1] || {}, forecastData: matchingData });
      predictedHours.push(prediction);
      lastKnownSLA = prediction.sla;
      const ev = prediction.estimatedVolume || 0;
      cumVol += ev;
      cumHandled += ev * prediction.sla / 100;
    }
  
    const allHours = [
      ...actualHours.map(h => ({ hour: h.hour, sla: roundTo(h.sla, 1), volume: h.volume || 0, fte: h.fte || 0, fteGap: (h.fteNeeded || 0) - (h.fte || 0), backlog: h.backlog || 0, type: 'actual', confidence: 100 })),
      ...predictedHours,
    ];
  
    const overallSLA = cumVol > 0 ? roundTo(cumHandled / cumVol * 100, 1) : 0;
    const risk = assessRisk(allHours, channel, target);
  
    return { channel, target, hours: allHours, health: 0, summary: { overallSLA, target, gap: roundTo(overallSLA - target, 1), meetingTarget: overallSLA >= target, trend: trend.direction, trendStrength: trend.strength, actualHoursCount: actualHours.length, predictedHoursCount: predictedHours.length, currentSLA: actualHours.length > 0 ? roundTo(actualHours[actualHours.length - 1].sla, 1) : null, weightedAvgSLA: roundTo(weightedAvg, 1), bestHour: getBestHour(allHours), worstHour: getWorstHour(allHours), risk } };
  }
  
  function predictFromForecastOnly(hourlyData, channel, target) {
    const hours = [];
    let cumVol = 0, cumHandled = 0;
  
    for (let h = CONFIG.OPERATING_HOURS.start; h < CONFIG.OPERATING_HOURS.end; h++) {
      const data = hourlyData.find(d => d.hour === h) || {};
      const fte = data.fteScheduled || data.fte || data.fteNeeded || 0;
      const volume = data.midFCVol || data.volume || 0;
      const fteNeeded = data.fteNeeded || 0;
      const fteGap = fteNeeded > 0 ? fteNeeded - fte : 0;
      const shrinkage = data.shrinkage || 0;
  
      let predictedSLA = target;
      if (fteGap > 0) predictedSLA -= fteGap * CONFIG.FTE_GAP_SLA_IMPACT[channel];
      else if (fteGap < 0) predictedSLA += Math.min(5, Math.abs(fteGap) * 1.5);
      if (shrinkage > 0) predictedSLA -= shrinkage * 15;
  
      const hourFactor = getHourVolumeFactor(h);
      predictedSLA -= (hourFactor - 1.0) * CONFIG.VOLUME_SLA_SENSITIVITY[channel];
      predictedSLA = Math.max(CONFIG.SLA_FLOOR[channel], Math.min(CONFIG.SLA_CEILING[channel], predictedSLA));
  
      const estVol = volume > 0 ? volume : Math.round(50 * hourFactor);
      cumVol += estVol;
      cumHandled += estVol * predictedSLA / 100;
  
      hours.push({ hour: h, sla: roundTo(predictedSLA, 1), estimatedVolume: estVol, volume: volume, fte: fte, fteGap: fteGap, type: 'forecast', confidence: Math.max(20, 60 - Math.abs(fteGap) * 5), risk: predictedSLA < target - 10 ? 'critical' : predictedSLA < target - 5 ? 'high' : predictedSLA < target ? 'medium' : 'low' });
    }
  
    const overallSLA = cumVol > 0 ? roundTo(cumHandled / cumVol * 100, 1) : target;
    const risk = assessRisk(hours, channel, target);
  
    return { channel, target, hours, health: 0, summary: { overallSLA, target, gap: roundTo(overallSLA - target, 1), meetingTarget: overallSLA >= target, trend: 'stable', trendStrength: 'weak', actualHoursCount: 0, predictedHoursCount: hours.length, currentSLA: null, weightedAvgSLA: roundTo(overallSLA, 1), bestHour: getBestHour(hours), worstHour: getWorstHour(hours), risk } };
  }
  
  function predictSingleHour({ hour, channel, lastSLA, trend, weightedAvg, hoursAhead, lastHourData, forecastData }) {
    const ceiling = CONFIG.SLA_CEILING[channel], floor = CONFIG.SLA_FLOOR[channel], target = CONFIG.SLA_TARGETS[channel];
    const blendFactor = Math.min(0.7, 0.3 + hoursAhead * 0.1);
    let predicted = lastSLA * (1 - blendFactor) + weightedAvg * blendFactor;
  
    const trendDamping = Math.exp(-0.3 * hoursAhead);
    predicted += trend.slope * trendDamping;
  
    const hourFactor = getHourVolumeFactor(hour);
    predicted -= (hourFactor - 1.0) * CONFIG.VOLUME_SLA_SENSITIVITY[channel];
  
    const fte = forecastData.fteScheduled || forecastData.fte || lastHourData.fte || 0;
    const fteNeeded = forecastData.fteNeeded || lastHourData.fteNeeded || 0;
    const fteGap = fteNeeded - fte;
    if (fteGap > 0) predicted -= fteGap * CONFIG.FTE_GAP_SLA_IMPACT[channel] * trendDamping;
  
    const shrinkage = forecastData.shrinkage || 0;
    if (shrinkage > 0) predicted -= shrinkage * 10;
  
    predicted = Math.max(floor, Math.min(ceiling, predicted));
  
    const baseVolume = forecastData.midFCVol || forecastData.volume || lastHourData.volume || 50;
    const estimatedVolume = Math.round(baseVolume * hourFactor);
    const confidence = Math.max(30, 95 - hoursAhead * 12);
  
    let risk = 'low';
    if (predicted < target - 10) risk = 'critical';
    else if (predicted < target - 5) risk = 'high';
    else if (predicted < target) risk = 'medium';
  
    return { hour, sla: roundTo(predicted, 1), estimatedVolume, type: 'predicted', confidence: Math.round(confidence), risk, factors: { trend: roundTo(trend.slope * trendDamping, 2), volumeImpact: roundTo(-(hourFactor - 1.0) * CONFIG.VOLUME_SLA_SENSITIVITY[channel], 2), fteGapImpact: fteGap > 0 ? roundTo(-fteGap * CONFIG.FTE_GAP_SLA_IMPACT[channel] * trendDamping, 2) : 0 } };
  }
  
  function calculateTrend(dataPoints) {
    const values = dataPoints.map(d => d.sla || 0);
    if (values.length < 2) return { slope: 0, direction: 'stable', strength: 0 };
    const n = values.length, xMean = (n - 1) / 2, yMean = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - xMean) * (values[i] - yMean); den += (i - xMean) ** 2; }
    const slope = den !== 0 ? num / den : 0;
    const absSlope = Math.abs(slope);
    let direction = 'stable';
    if (slope > 0.5) direction = 'improving';
    else if (slope < -0.5) direction = 'declining';
    let strength = 'weak';
    if (absSlope > 3) strength = 'strong';
    else if (absSlope > 1.5) strength = 'moderate';
    return { slope: roundTo(slope, 2), direction, strength };
  }
  
  function calculateWeightedAverage(values) {
    if (!values || values.length === 0) return 0;
    const weights = CONFIG.RECENCY_WEIGHTS;
    const n = values.length;
    const useWeights = n >= weights.length ? weights : weights.slice(weights.length - n);
    const weightSum = useWeights.reduce((a, b) => a + b, 0);
    const normalized = useWeights.map(w => w / weightSum);
    const recentValues = values.slice(-normalized.length);
    let weighted = 0;
    for (let i = 0; i < recentValues.length; i++) weighted += recentValues[i] * normalized[i];
    return weighted;
  }
  
  function getHourVolumeFactor(hour) {
    const pattern = { 9: 0.7, 10: 0.9, 11: 1.1, 12: 1.15, 13: 1.2, 14: 1.15, 15: 1.1, 16: 1.0, 17: 0.9, 18: 0.75, 19: 0.6, 20: 0.5, 21: 0.4 };
    return pattern[hour] || 1.0;
  }
  
  function assessRisk(allHours, channel, target) {
    const predicted = allHours.filter(h => h.type === 'predicted' || h.type === 'forecast');
    const belowTarget = predicted.filter(h => h.sla < target);
    const critical = predicted.filter(h => h.sla < target - 10);
    let level = 'low', message = 'On track to meet SLA target';
    if (critical.length >= 2) { level = 'critical'; message = `${critical.length} hours predicted critically below target. Immediate action needed.`; }
    else if (belowTarget.length >= 3) { level = 'high'; message = `${belowTarget.length} hours predicted below target. Consider adding FTE.`; }
    else if (belowTarget.length >= 1) { level = 'medium'; message = `${belowTarget.length} hour(s) may dip below target. Monitor closely.`; }
    return { level, message, belowTargetCount: belowTarget.length, criticalCount: critical.length };
  }
  
  export function generateRecommendations(predictions) {
    const recs = [];
    for (const [channel, pred] of Object.entries(predictions)) {
      if (!pred.summary) continue;
      const { summary } = pred;
      if (summary.risk.level === 'critical') recs.push({ priority: 'critical', channel, action: `Add 2+ FTE to ${channel} immediately`, reason: `${summary.risk.criticalCount} hours critically below ${summary.target}% target`, impact: `Could improve SLA by ${Math.min(8, summary.risk.criticalCount * 2)}+ points` });
      if (summary.trend === 'declining' && summary.trendStrength !== 'weak') recs.push({ priority: 'high', channel, action: `Investigate ${channel} SLA decline trend`, reason: `${summary.trendStrength} downward trend detected`, impact: 'Early intervention can prevent target miss' });
      if (summary.gap < -5) recs.push({ priority: 'high', channel, action: `Projected day-end SLA ${summary.overallSLA}% — ${Math.abs(summary.gap)} pts below target`, reason: 'Volume or staffing adjustment needed', impact: `Need to recover ${Math.abs(summary.gap)} points` });
      if (summary.worstHour && summary.worstHour.sla < summary.target - 15) recs.push({ priority: 'medium', channel, action: `Worst predicted hour: ${summary.worstHour.hour}:00 at ${summary.worstHour.sla}%`, reason: 'Consider pre-positioning extra staff', impact: 'Preventing the worst hour improves overall day SLA' });
    }
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    return recs;
  }
  
  function roundTo(num, decimals) { return Math.round(num * 10 ** decimals) / 10 ** decimals; }
  function getBestHour(hours) { if (hours.length === 0) return null; return hours.reduce((best, h) => h.sla > best.sla ? h : best, hours[0]); }
  function getWorstHour(hours) { if (hours.length === 0) return null; return hours.reduce((worst, h) => h.sla < worst.sla ? h : worst, hours[0]); }