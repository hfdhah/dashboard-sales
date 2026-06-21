// anomalyDetector.js
// Semua fungsi deteksi anomali statistik untuk AI-Augmented Dashboard


function mean(arr) {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr) {
  const m = mean(arr);
  if (arr.length === 0) return 0;
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function zScore(value, arr) {
  const s = stdDev(arr);
  return s === 0 ? 0 : (value - mean(arr)) / s;
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx    = (p / 100) * (sorted.length - 1);
  const lower  = Math.floor(idx);
  const frac   = idx - lower;
  return sorted[lower] + frac * (sorted[lower + 1] - sorted[lower] || 0);
}

function detectProfitOutliers(data, threshold = 1.5) {
  const bySubcat = d3.rollups(
    data,
    v => ({
      profit: d3.sum(v, d => d.profit),
      sales:  d3.sum(v, d => d.sales)
    }),
    d => d.subcat
  ).map(([name, v]) => ({
    name,
    profit: v.profit,
    sales:  v.sales,
    margin: v.sales > 0 ? (v.profit / v.sales * 100) : 0
  }));

  const margins = bySubcat.map(d => d.margin);

  return bySubcat
    .map(d => {
      const z = zScore(d.margin, margins);
      return {
        type:      'profit_outlier',
        name:      d.name,
        margin:    d.margin.toFixed(1),
        profit:    d.profit.toFixed(0),
        zScore:    z.toFixed(2),
        direction: z > 0 ? 'high' : 'low',
        severity:  Math.abs(z) > 2 ? 'severe' : 'warning',
        isOutlier: Math.abs(z) > threshold 
      };
    })
    .filter(d => d.isOutlier)
    .sort((a, b) => +a.zScore - +b.zScore); 
}

// deteksi perubahan MoM 
function detectMoMSpikes(data, threshold = 25) {
  const byMonth = d3.rollups(
    data,
    v => d3.sum(v, d => d.sales),
    d => {
      const dt = d.orderDate;
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    }
  )
  .map(([month, sales]) => ({ month, sales }))
  .sort((a, b) => a.month.localeCompare(b.month));

  const anomalies = [];

  for (let i = 1; i < byMonth.length; i++) {
    const curr = byMonth[i];
    const prev = byMonth[i - 1];

    if (prev.sales === 0) continue;

    const momPct = ((curr.sales - prev.sales) / Math.abs(prev.sales)) * 100;
    if (Math.abs(momPct) >= threshold) {
      anomalies.push({
        type:      'mom_spike',
        month:     curr.month,
        prevMonth: prev.month,
        current:   curr.sales.toFixed(0),
        previous:  prev.sales.toFixed(0),
        changePct: momPct.toFixed(1),
        direction: momPct > 0 ? 'spike' : 'drop',
        severity:  Math.abs(momPct) >= 40 ? 'severe' : 'warning'
      });
    }
  }
  return anomalies
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 5);
}

function detectIQROutliers(data) {
  if (data.length === 0) {
    return { fences: { lower: '0.00', upper: '0.00' }, totalOutliers: 0, pctOutliers: '0.0', bySubcat: [] };
  }

  const salesVals = data.map(d => d.sales);
  const Q1   = percentile(salesVals, 25);
  const Q3   = percentile(salesVals, 75);
  const IQR  = Q3 - Q1;
  const lower = Q1 - 1.5 * IQR;
  const upper = Q3 + 1.5 * IQR;
  const outliers = data.filter(d => d.sales < lower || d.sales > upper);
  const bySubcat = d3.rollups(
    outliers,
    v => ({
      count:     v.length,
      avgSales:  +d3.mean(v, d => d.sales).toFixed(0),
      maxSales:  +d3.max(v, d => d.sales).toFixed(0),
      direction: v.filter(d => d.sales > upper).length > v.length / 2 ? 'high' : 'low'
    }),
    d => d.subcat
  )
  .map(([subcat, v]) => ({
    type: 'iqr_outlier',
    subcat,
    ...v,
    severity: v.count > 10 ? 'warning' : 'info'
  }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 5); 

  return {
    fences: { lower: lower.toFixed(2), upper: upper.toFixed(2) },
    totalOutliers: outliers.length,
    pctOutliers:   ((outliers.length / data.length) * 100).toFixed(1),
    bySubcat:      bySubcat
  };
}

function detectRegionOutliers(data, threshold = 1.5) {
  const regionMap = d3.rollups(
    data,
    v => {
      const totalSales = d3.sum(v, d => d.sales);
      const totalProfit = d3.sum(v, d => d.profit);
      return {
        sales:  totalSales,
        profit: totalProfit,
        margin: totalSales > 0 ? (totalProfit / totalSales * 100) : 0
      };
    },
    d => d.region
  );

  if (regionMap.length === 0) return [];
  const margins = regionMap.map(([name, stats]) => stats.margin);
  const meanMargin = d3.mean(margins);
  const stdDevMargin = d3.deviation(margins) || 1;
  const outliers = [];

  regionMap.forEach(([name, stats]) => {
    const z = (stats.margin - meanMargin) / stdDevMargin;
    if (z < -threshold) {
      outliers.push({
        type:     'region_outlier',
        name:     name,
        margin:   stats.margin.toFixed(1),
        zScore:   z.toFixed(2),
        severity: 'warning'
      });
    }
  });

  return outliers;
}

function countSeverity(anomalies) {
  const allAnomalies = [
    ...anomalies.profitOutliers,
    ...anomalies.momSpikes,
    ...(anomalies.iqrOutliers?.bySubcat || []),
    ...anomalies.regionOutliers 
  ];
  return {
    severe:  allAnomalies.filter(d => d.severity === 'severe').length,
    warning: allAnomalies.filter(d => d.severity === 'warning').length,
    info:    allAnomalies.filter(d => d.severity === 'info').length
  };
}

function detectAllAnomalies(data, zScoreDashboard = 1.5, momDashboard = 25) {
  const outputs = {
    profitOutliers: detectProfitOutliers(data, zScoreDashboard),
    momSpikes:      detectMoMSpikes(data, momDashboard),
    iqrOutliers:    detectIQROutliers(data),
    regionOutliers: detectRegionOutliers(data, zScoreDashboard) 
  };

  outputs.severityCount = countSeverity(outputs);

  return outputs;
}