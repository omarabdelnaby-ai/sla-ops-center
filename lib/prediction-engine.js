/**
 * SLA OPS CENTER — Prediction Engine v3
 * Erlang C + Hour Chaining + ML-Ready Correction Layer
 */

const CONFIG = {
  SLA_TARGETS: { chat: 70, email: 90, phone: 80 },
  SLA_THRESHOLDS_SEC: { chat: 180, email: 7200, phone: 20 },
  OPERATING_HOURS: { start: 9, end: 23 },
  INTERVAL_SECONDS: 3600,
  DEFAULTS: {
    chat:  { aht: 600, concurrency: 1.5, shrinkage: 0.10, utilization: 0.85 },
    email: { aht: 480, concurrency: 1.0, shrinkage: 0.10, utilization: 0.80 },
    phone: { aht: 300, concurrency: 1.0, shrinkage: 0.10, utilization: 0.85 },
  },
  FATIGUE_CURVE: { 9:1.0, 10:1.0, 11:1.0, 12:1.02, 13:1.04, 14:1.06, 15:1.08, 16:1.10, 17:1.12, 18:1.10, 19:1.08, 20:1.06, 21:1.04, 22:1.02 },
  VOLUME_CURVE:  { 9:0.7, 10:0.9, 11:1.1, 12:1.15, 13:1.2, 14:1.15, 15:1.1, 16:1.0, 17:0.9, 18:0.75, 19:0.6, 20:0.5, 21:0.4, 22:0.3 },
  ML_WEIGHT: 0,
};

function erlangC(agents, trafficIntensity) {
  if (agents <= 0 || trafficIntensity <= 0) return 0;
  if (agents <= trafficIntensity) return 1;
  const n = Math.floor(agents);
  const a = trafficIntensity;
  let sumTerms = 0;
  for (let k = 0; k < n; k++) {
    sumTerms += Math.pow(a, k) / factorial(k);
  }
  const lastTerm = Math.pow(a, n) / factorial(n) * (n / (n - a));
  const pw = lastTerm / (sumTerms + lastTerm);
  return Math.max(0, Math.min(1, pw));
}

function erlangSLA(agents, volume, ahtSeconds, thresholdSeconds, intervalSeconds) {
  if (volume <= 0 || agents <= 0) return 100;
  const arrivalRate = volume / intervalSeconds;
  const serviceRate = 1 / ahtSeconds;
  const trafficIntensity = arrivalRate / serviceRate;
  if (agents <= trafficIntensity) return 0;
  const pw = erlangC(agents, trafficIntensity);
  const avgWait = pw * (ahtSeconds / (agents - trafficIntensity));
  if (avgWait <= 0) return 100;
  const sla = (1 - pw * Math.exp(-(agents - trafficIntensity) * (thresholdSeconds / ahtSeconds))) * 100;
  return Math.max(0, Math.min(100, sla));
}

function emailSLA(agents, volume, ahtSeconds, thresholdSeconds, intervalSeconds) {
  if (volume <= 0) return 100;
  if (agents <= 0) return 0;
  const throughputPerHour = (agents * intervalSeconds) / ahtSeconds;
  const ratio = throughputPerHour / volume;
  if (ratio >= 1.5) return Math.min(98, 80 + ratio * 12);
  if (ratio >= 1.0) return Math.min(95, 60 + ratio * 30);
  if (ratio >= 0.7) return Math.max(30, ratio * 70);
  return Math.max(5, ratio * 40);
}

function chatSLA(agents, volume, ahtSeconds, concurrency, thresholdSeconds, intervalSeconds) {
  const effectiveAgents = agents * Math.max(1, concurrency);
  return erlangSLA(effectiveAgents, volume, ahtSeconds / Math.max(1, concurrency), thresholdSeconds, intervalSeconds);
}

function factorial(n) {
  if (n <= 1) return 1;
  if (n > 170) return Infinity;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function calculateEffectiveFTE(data, channel, defaults) {
  const fte = data.fte || data.fteScheduled || 0;
  const concurrency = data.concurrency || defaults.concurrency;
  const shrinkage = parseShrinkage(data.shrinkage || defaults.shrinkage);
  const utilization = parseUtilization(data.utilization || defaults.utilization);
  const effectiveFTE = fte * (1 - shrinkage) * utilization;
  return {
    raw: fte,
    effective: Math.max(0, effectiveFTE),
    concurrency: channel === 'chat' ? concurrency : 1,
    shrinkage: shrinkage,
    utilization: utilization,
  };
}

function parseShrinkage(val) {
  if (typeof val === 'string' && val.includes('%')) return parseFloat(val) / 100;
  const num = parseFloat(val) || 0;
  return num > 1 ? num / 100 : num;
}

function parseUtilization(val) {
  if (typeof val === 'string' && val.includes('%')) return parseFloat(val) / 100;
  const num = parseFloat(val) || 0;
  if (num === 0) return 0.85;
  return num > 1 ? num / 100 : num;
}

function getAHTWithFatigue(baseAHT, hour) {
  const fatigue = CONFIG.FATIGUE_CURVE[hour] || 1.0;
  return baseAHT * fatigue;
}

function projectShrinkage(morningShrin, hour) {
  if (hour <= 12) return morningShrin;
  const afternoonFactor = 1 + (hour - 12) * 0.03;
  return Math.min(0.35, morningShrin * afternoonFactor);
}

function calculateSLAForHour(channel, volume, ahtSeconds, agents, concurrency) {
  const threshold = CONFIG.SLA_THRESHOLDS_SEC[channel];
  const interval = CONFIG.INTERVAL_SECONDS;
  if (channel === 'email') return emailSLA(agents, volume, ahtSeconds, threshold, interval);
  if (channel === 'chat') return chatSLA(agents, volume, ahtSeconds, concurrency, threshold, interval);
  return erlangSLA(agents, volume, ahtSeconds, threshold, interval);
}

export function predictChannel(hourlyData, channel) {
  if (!hourlyData || hourlyData.length === 0) return { error: 'No data', hours: [], summary: null };

  const target = CONFIG.SLA_TARGETS[channel] || 80;
  const defaults = CONFIG.DEFAULTS[channel] || CONFIG.DEFAULTS.phone;
  const totalSlots = CONFIG.OPERATING_HOURS.end - CONFIG.OPERATING_HOURS.start;

  const actualHours = hourlyData.filter(h => h.sla > 0 || h.volume > 0 || h.fte > 0);
  const hasActualSLA = hourlyData.some(h => h.sla > 0);

  if (!hasActualSLA) return predictFullDayFromForecast(hourlyData, channel, target, defaults);

  const processedActual = [];
  let carryBacklog = 0;
  let morningShrin = defaults.shrinkage;
  let ahtValues = [];

  for (const h of actualHours) {
    const fteInfo = calculateEffectiveFTE(h, channel, defaults);
    const aht = h.aht || defaults.aht;
    ahtValues.push(aht);
    if (h.hour <= 11 && h.shrinkage > 0) morningShrin = parseShrinkage(h.shrinkage);

    processedActual.push({
      hour: h.hour,
      sla: roundTo(h.sla, 1),
      volume: h.volume || 0,
      fte: fteInfo.raw,
      fteEffective: roundTo(fteInfo.effective, 1),
      fteGap: roundTo((h.fteNeeded || 0) - fteInfo.raw, 1),
      backlog: h.backlog || 0,
      aht: roundTo(aht, 0),
      concurrency: fteInfo.concurrency,
      shrinkage: roundTo(fteInfo.shrinkage * 100, 1),
      utilization: roundTo(fteInfo.utilization * 100, 1),
      occupancy: h.occupancy || 0,
      type: 'actual',
      confidence: 100,
      erlangPrediction: roundTo(calculateSLAForHour(channel, h.volume || 0, aht, fteInfo.effective * fteInfo.concurrency, fteInfo.concurrency), 1),
    });

    carryBacklog = h.backlog || 0;
  }

  const lastActual = actualHours[actualHours.length - 1];
  const lastHour = lastActual.hour;
  const avgAHT = ahtValues.length > 0 ? ahtValues.reduce((a, b) => a + b, 0) / ahtValues.length : defaults.aht;
  const trend = calculateTrend(processedActual.filter(h => h.sla > 0));

  const predictedHours = [];
  let prevBacklog = carryBacklog;

  for (let hour = lastHour + 1; hour < CONFIG.OPERATING_HOURS.end; hour++) {
    const forecastData = hourlyData.find(h => h.hour === hour) || {};
    const forecastVol = forecastData.midFCVol || forecastData.volume || Math.round(50 * (CONFIG.VOLUME_CURVE[hour] || 1.0));
    const totalVolume = forecastVol + prevBacklog;

    const scheduledFTE = forecastData.fteScheduled || forecastData.fteNeeded || lastActual.fteScheduled || lastActual.fteNeeded || 0;
    const projectedShrinkage = projectShrinkage(morningShrin, hour);
    const projectedUtil = parseUtilization(forecastData.utilization || defaults.utilization);
    const projectedConc = forecastData.concurrency || defaults.concurrency;
    const effectiveFTE = scheduledFTE * (1 - projectedShrinkage) * projectedUtil;

    const projectedAHT = getAHTWithFatigue(avgAHT, hour);

    const erlangSLAVal = calculateSLAForHour(channel, totalVolume, projectedAHT, effectiveFTE * (channel === 'chat' ? projectedConc : 1), projectedConc);

    const mlCorrection = getMLCorrection(channel, hour, erlangSLAVal, { volume: totalVolume, fte: effectiveFTE, aht: projectedAHT, backlog: prevBacklog, shrinkage: projectedShrinkage });

    const finalSLA = roundTo(Math.max(0, Math.min(100, erlangSLAVal + mlCorrection)), 1);

    const throughput = effectiveFTE * (channel === 'chat' ? projectedConc : 1) * (CONFIG.INTERVAL_SECONDS / projectedAHT);
    const newBacklog = Math.max(0, Math.round(totalVolume - throughput));

    const hoursAhead = hour - lastHour;
    const confidence = Math.max(25, 95 - hoursAhead * 8 - (prevBacklog > 10 ? 10 : 0));

    let risk = 'low';
    if (finalSLA < target - 15) risk = 'critical';
    else if (finalSLA < target - 8) risk = 'high';
    else if (finalSLA < target) risk = 'medium';

    predictedHours.push({
      hour,
      sla: finalSLA,
      volume: forecastVol,
      totalVolume: totalVolume,
      estimatedVolume: forecastVol,
      fte: roundTo(scheduledFTE, 1),
      fteEffective: roundTo(effectiveFTE, 1),
      fteGap: roundTo((forecastData.fteNeeded || 0) - scheduledFTE, 1),
      backlog: newBacklog,
      aht: roundTo(projectedAHT, 0),
      shrinkage: roundTo(projectedShrinkage * 100, 1),
      utilization: roundTo(projectedUtil * 100, 1),
      concurrency: projectedConc,
      type: 'predicted',
      confidence: Math.round(confidence),
      risk,
      erlangPrediction: roundTo(erlangSLAVal, 1),
      mlCorrection: roundTo(mlCorrection, 1),
      factors: {
        backlogImpact: prevBacklog,
        fatigueMultiplier: CONFIG.FATIGUE_CURVE[hour] || 1.0,
        shrinkageProjected: roundTo(projectedShrinkage * 100, 1),
      },
    });

    prevBacklog = newBacklog;
  }

  const allHours = [...processedActual, ...predictedHours];

  let cumVol = 0, cumHandled = 0;
  for (const h of allHours) {
    const vol = h.totalVolume || h.volume || 0;
    cumVol += vol;
    cumHandled += vol * h.sla / 100;
  }

  const overallSLA = cumVol > 0 ? roundTo(cumHandled / cumVol * 100, 1) : 0;
  const risk = assessRisk(allHours, channel, target);

  return {
    channel,
    target,
    hours: allHours,
    health: 0,
    summary: {
      overallSLA,
      target,
      gap: roundTo(overallSLA - target, 1),
      meetingTarget: overallSLA >= target,
      trend: trend.direction,
      trendStrength: trend.strength,
      actualHoursCount: processedActual.length,
      predictedHoursCount: predictedHours.length,
      currentSLA: processedActual.length > 0 ? processedActual[processedActual.length - 1].sla : null,
      weightedAvgSLA: roundTo(calculateWeightedAverage(processedActual.filter(h => h.sla > 0).map(h => h.sla)), 1),
      bestHour: getBestHour(allHours),
      worstHour: getWorstHour(allHours),
      risk,
      engineVersion: 'v3-erlangC',
      mlActive: CONFIG.ML_WEIGHT > 0,
      totalBacklog: prevBacklog,
    },
  };
}

function predictFullDayFromForecast(hourlyData, channel, target, defaults) {
  const hours = [];
  let prevBacklog = 0;
  let cumVol = 0, cumHandled = 0;

  for (let hour = CONFIG.OPERATING_HOURS.start; hour < CONFIG.OPERATING_HOURS.end; hour++) {
    const data = hourlyData.find(d => d.hour === hour) || {};
    const forecastVol = data.midFCVol || data.volume || Math.round(50 * (CONFIG.VOLUME_CURVE[hour] || 1.0));
    const totalVolume = forecastVol + prevBacklog;

    const scheduledFTE = data.fteScheduled || data.fteNeeded || 0;
    const shrinkage = parseShrinkage(data.shrinkage || defaults.shrinkage);
    const utilization = parseUtilization(data.utilization || defaults.utilization);
    const concurrency = data.concurrency || defaults.concurrency;
    const effectiveFTE = scheduledFTE * (1 - shrinkage) * utilization;

    const aht = getAHTWithFatigue(data.aht || defaults.aht, hour);

    const sla = calculateSLAForHour(channel, totalVolume, aht, effectiveFTE * (channel === 'chat' ? concurrency : 1), concurrency);

    const throughput = effectiveFTE * (channel === 'chat' ? concurrency : 1) * (CONFIG.INTERVAL_SECONDS / aht);
    const newBacklog = Math.max(0, Math.round(totalVolume - throughput));

    cumVol += totalVolume;
    cumHandled += totalVolume * sla / 100;

    let risk = 'low';
    if (sla < target - 15) risk = 'critical';
    else if (sla < target - 8) risk = 'high';
    else if (sla < target) risk = 'medium';

    hours.push({
      hour,
      sla: roundTo(sla, 1),
      volume: forecastVol,
      totalVolume: totalVolume,
      estimatedVolume: forecastVol,
      fte: roundTo(scheduledFTE, 1),
      fteEffective: roundTo(effectiveFTE, 1),
      fteGap: roundTo((data.fteNeeded || 0) - scheduledFTE, 1),
      backlog: newBacklog,
      aht: roundTo(aht, 0),
      shrinkage: roundTo(shrinkage * 100, 1),
      utilization: roundTo(utilization * 100, 1),
      concurrency: concurrency,
      type: 'forecast',
      confidence: Math.max(20, 65 - Math.abs((data.fteNeeded || 0) - scheduledFTE) * 5),
      risk,
      erlangPrediction: roundTo(sla, 1),
      mlCorrection: 0,
    });

    prevBacklog = newBacklog;
  }

  const overallSLA = cumVol > 0 ? roundTo(cumHandled / cumVol * 100, 1) : target;
  const riskAssess = assessRisk(hours, channel, target);

  return {
    channel,
    target,
    hours,
    health: 0,
    summary: {
      overallSLA,
      target,
      gap: roundTo(overallSLA - target, 1),
      meetingTarget: overallSLA >= target,
      trend: 'stable',
      trendStrength: 'weak',
      actualHoursCount: 0,
      predictedHoursCount: hours.length,
      currentSLA: null,
      weightedAvgSLA: roundTo(overallSLA, 1),
      bestHour: getBestHour(hours),
      worstHour: getWorstHour(hours),
      risk: riskAssess,
      engineVersion: 'v3-erlangC',
      mlActive: false,
      totalBacklog: prevBacklog,
    },
  };
}

function getMLCorrection(channel, hour, erlangSLA, features) {
  if (CONFIG.ML_WEIGHT === 0) return 0;
  return 0;
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
  const weights = [0.05, 0.08, 0.12, 0.15, 0.20, 0.40];
  const n = values.length;
  const useWeights = n >= weights.length ? weights : weights.slice(weights.length - n);
  const weightSum = useWeights.reduce((a, b) => a + b, 0);
  const normalized = useWeights.map(w => w / weightSum);
  const recentValues = values.slice(-normalized.length);
  let weighted = 0;
  for (let i = 0; i < recentValues.length; i++) weighted += recentValues[i] * normalized[i];
  return weighted;
}

function assessRisk(allHours, channel, target) {
  const predicted = allHours.filter(h => h.type === 'predicted' || h.type === 'forecast');
  const belowTarget = predicted.filter(h => h.sla < target);
  const critical = predicted.filter(h => h.sla < target - 15);
  let level = 'low', message = 'On track to meet SLA target';
  if (critical.length >= 2) { level = 'critical'; message = critical.length + ' hours predicted critically below target. Immediate action needed.'; }
  else if (belowTarget.length >= 3) { level = 'high'; message = belowTarget.length + ' hours predicted below target. Consider adding FTE.'; }
  else if (belowTarget.length >= 1) { level = 'medium'; message = belowTarget.length + ' hour(s) may dip below target. Monitor closely.'; }
  return { level, message, belowTargetCount: belowTarget.length, criticalCount: critical.length };
}

export function generateRecommendations(predictions) {
  const recs = [];
  for (const [channel, pred] of Object.entries(predictions)) {
    if (!pred.summary) continue;
    const s = pred.summary;
    if (s.risk.level === 'critical') recs.push({ priority: 'critical', channel, action: 'Add 2+ FTE to ' + channel + ' immediately', reason: s.risk.criticalCount + ' hours critically below ' + s.target + '% target', impact: 'Could improve SLA by ' + Math.min(8, s.risk.criticalCount * 2) + '+ points' });
    if (s.trend === 'declining' && s.trendStrength !== 'weak') recs.push({ priority: 'high', channel, action: 'Investigate ' + channel + ' SLA decline trend', reason: s.trendStrength + ' downward trend detected', impact: 'Early intervention can prevent target miss' });
    if (s.gap < -5) recs.push({ priority: 'high', channel, action: 'Projected day-end SLA ' + s.overallSLA + '% — ' + Math.abs(s.gap) + ' pts below target', reason: 'Volume or staffing adjustment needed', impact: 'Need to recover ' + Math.abs(s.gap) + ' points' });
    if (s.totalBacklog > 10) recs.push({ priority: 'high', channel, action: 'Backlog at ' + s.totalBacklog + ' — clear before it cascades', reason: 'Backlog carries forward and compounds each hour', impact: 'Clearing backlog now prevents SLA spiral' });
    if (s.worstHour && s.worstHour.sla < s.target - 15) recs.push({ priority: 'medium', channel, action: 'Worst predicted hour: ' + s.worstHour.hour + ':00 at ' + s.worstHour.sla + '%', reason: 'Consider pre-positioning extra staff', impact: 'Preventing the worst hour improves overall day SLA' });
  }
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recs.sort(function(a, b) { return priorityOrder[a.priority] - priorityOrder[b.priority]; });
  return recs;
}

function roundTo(num, decimals) { return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals); }
function getBestHour(hours) { if (hours.length === 0) return null; return hours.reduce(function(best, h) { return h.sla > best.sla ? h : best; }, hours[0]); }
function getWorstHour(hours) { if (hours.length === 0) return null; return hours.reduce(function(worst, h) { return h.sla < worst.sla ? h : worst; }, hours[0]); }