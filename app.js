const COLOR = {
  normal:   '#94a3b8',   // abu-abu: data normal/background
  good:     '#16a34a',   // hijau: profit positif, target tercapai
  warn:     '#d97706',   // kuning: perhatian, hampir batas
  severe:   '#dc2626',   // merah: anomali kritis, rugi
  warning:  '#ea580c',   // oranye: anomali sedang
  accent:   '#2563eb',   // biru: highlight utama, tren
  highlight:'#7c3aed',   // ungu: secondary highlight
};

function anomalyColor(severity) {
  return COLOR[severity] || COLOR.normal;
}

function profitColor(value) {
  if (value < 0)  return COLOR.severe;
  if (value < 10) return COLOR.warn;
  return COLOR.good;
}

function updateChartTitles(anomalies) {
  const worstProfit = anomalies.profitOutliers[0];
  const worstMoM    = anomalies.momSpikes[0];

  // Chart subcat
  if (worstProfit) {
    const sign = +worstProfit.margin < 0 ? 'RUGI' : 'Outlier';
    document.getElementById('chart-title-subcat').textContent =
      `Profit Margin per Sub-Kategori — ${worstProfit.name} ${sign} (${worstProfit.margin}%)`;
  }

  // Chart tren
  if (worstMoM) {
    const dir = worstMoM.direction === 'drop' ? 'Turun' : 'Naik';
    document.getElementById('chart-title-trend').textContent =
      `Tren Revenue — ${worstMoM.month} ${dir} ${Math.abs(worstMoM.changePct)}% (ditandai merah)`;
  }
}

// BAGIAN 1: VARIABEL GLOBAL & CLEANING ENGINE
let rawData = [];          
let summaryStats = {};    
let currentAnomalies = {}; 

// Kendali Threshold Aktif (Default)
let zScoreThreshold = 1.5;
let momThreshold = 25;

// Helper: parse angka
function parseNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  const num = parseFloat(String(val).trim().replace(',', '.'));
  return isNaN(num) ? 0 : num;
}

// Helper: parse tanggal dengan format DD/MM/YYYY atau YYYY-MM-DD
function parseDate(str) {
  if (!str) return null;
  const parts = str.trim().split('/');
  if (parts.length === 3) {
    const d = new Date(+parts[2], +parts[1] - 1, +parts[0]);
    return isNaN(d.getTime()) ? null : d;
  }
  // Fallback untuk format strip ISO YYYY-MM-DD
  const dIso = new Date(str);
  return isNaN(dIso.getTime()) ? null : dIso;
}

// LOAD DATA 
d3.csv('Sales_BY_Category_202606040914-1.csv').then(function(data) {
  
  console.log("Sampel data mentah dari Sales_BY_Category:", data[0]);

  rawData = data.map(d => {
    const category  = d['Category'] || d['category'] || '';
    const subcat    = d['SubCategory'] || d['Sub-Category'] || d['Sub-category'] || d['subcat'] || d['Sub Category'] || '';
    const region    = d['CountryRegion'] || d['Country-Region'] || d['Region'] || d['region'] || '';
    const segment   = d['Segment'] || d['segment'] || '';
    
    const salesVal  = d['Sales'] || d['sales'] || 0;
    const profitVal = d['Profit'] || d['profit'] || 0;
    const qtyVal    = d['Qty'] || d['qty'] || d['Quantity'] || d['quantity'] || 0;
    
    const dateRaw   = d['OrderDate'] || d['Order Date'] || d['order_date'];
    const parsedDate = parseDate(dateRaw); 

    return {
      category:  category,
      subcat:    subcat,
      region:    region ? region.trim() : '', 
      segment:   segment,
      sales:     parseNum(salesVal),
      profit:    parseNum(profitVal),
      quantity:  parseNum(qtyVal),
      orderDate: parsedDate ? parsedDate : new Date()
    };
  }).filter(d => !isNaN(d.sales) && d.category !== '');

  console.log(`Berhasil memuat ${rawData.length} baris data.`);

  // Inisialisasi kontrol threshold slider & dropdown di UI
  initThresholdControls();

  // Jalankan inisialisasi awal dashboard pertama kali
  if (rawData.length > 0) {
    updateDashboard('All');
  } else {
    console.error("Data kosong setelah proses mapping!");
  }

  // Event listener filter region dropdown
  d3.select('#region-filter').on('change', function(event) {
    const selectedRegion = event.target.value;
    
    const outputDiv = document.getElementById('insight-output');
    if (outputDiv) {
      outputDiv.innerHTML = `
        <p class="insight-placeholder" style="color: #ea580c; font-weight: 500;">
          ⚠️ Data wilayah berubah, memperbarui analisis cerita bisnis...
        </p>`;
    }
    updateDashboard(selectedRegion);
  });
}).catch(function(error) {
  console.error("Gagal membaca file CSV:", error);
});

// Fungsi Inisialisasi Kontrol Threshold Slider & Label Implikasi
function initThresholdControls() {
  const zSlider = d3.select('#zscore-slider');
  if (!zSlider.empty()) {
    zSlider.on('input', function(event) {
      zScoreThreshold = parseFloat(event.target.value);
      d3.select('#zscore-val').text(zScoreThreshold.toFixed(1));
      
      const implicationLabel = d3.select('#zscore-implication');
      if (zScoreThreshold < 1.2) {
        implicationLabel.text("Sensitivitas Tinggi: Banyak pencilan kecil akan ikut terdeteksi (Noise potensial).").style('color', '#dc2626');
      } else if (zScoreThreshold > 2.2) {
        implicationLabel.text("Sensitivitas Rendah: Hanya deviasi ekstrem/kritis yang akan ditangkap.").style('color', '#2563eb');
      } else {
        implicationLabel.text("Sensitivitas Normal: Keseimbangan statistik yang direkomendasikan.").style('color', '#4b5563');
      }

      const currentRegion = d3.select('#region-filter').property('value') || 'All';
      updateDashboard(currentRegion);
    });
  }

  const momInput = d3.select('#mom-input');
  if (!momInput.empty()) {
    momInput.on('input', function(event) {
      momThreshold = parseFloat(event.target.value) || 25;
      d3.select('#mom-val').text(momThreshold + '%');
      
      const currentRegion = d3.select('#region-filter').property('value') || 'All';
      updateDashboard(currentRegion);
    });
  }
}

// BAGIAN 2: STATISTIK ENGINE
function computeSummary(data) {
  const totalSales  = d3.sum(data, d => d.sales);
  const totalProfit = d3.sum(data, d => d.profit);
  const margin      = totalSales > 0 ? (totalProfit / totalSales * 100).toFixed(1) : 0;
  const totalOrders = data.length;

  const byCategory = d3.rollup(
    data,
    v => ({ sales: d3.sum(v, d => d.sales), profit: d3.sum(v, d => d.profit) }),
    d => d.category
  );

  const catArray = [...byCategory.entries()].map(([cat, v]) => ({
    category: cat,
    sales:    v.sales,
    profit:   v.profit,
    margin:   v.sales > 0 ? +(v.profit / v.sales * 100).toFixed(1) : 0
  })).sort((a, b) => b.margin - a.margin);

  const byRegion = d3.rollup(data, v => d3.sum(v, d => d.sales), d => d.region);
  const regionArray = [...byRegion.entries()]
    .map(([r, s]) => ({ region: r, sales: s }))
    .sort((a, b) => b.sales - a.sales);

  return {
    totalSales:    totalSales.toFixed(2),
    totalProfit:   totalProfit.toFixed(2),
    overallMargin: margin,
    totalOrders:   totalOrders,
    categories:    catArray,      
    regions:       regionArray,   
    bestCategory:  catArray[0] || { category: '-', margin: 0 }, 
    worstCategory: catArray[catArray.length - 1] || { category: '-', margin: 0 }
  };
}

// RINGKASAN PERFORMA PER KATEGORI 
function renderCategoryPerformanceSummary(stats) {
  const container = document.getElementById('category-table');
  if (!container || !stats.categories || stats.categories.length === 0) return;

  const rows = stats.categories.map(c => {
    const marginColor = c.margin < 0 ? '#dc2626' : c.margin < 10 ? '#d97706' : '#16a34a';
    const profitColor = c.profit < 0 ? '#dc2626' : '#16a34a';
    return `
      <tr>
        <td style="padding:14px 12px;font-size:0.9rem;color:#1e293b;border-bottom:1px solid #f1f5f9;">${c.category}</td>
        <td style="padding:14px 12px;font-size:0.9rem;color:#2563eb;border-bottom:1px solid #f1f5f9;text-align:right;">$${(c.sales/1000).toFixed(1)}K</td>
        <td style="padding:14px 12px;font-size:0.9rem;color:${profitColor};border-bottom:1px solid #f1f5f9;text-align:right;">$${(c.profit/1000).toFixed(1)}K</td>
        <td style="padding:14px 12px;font-size:0.9rem;font-weight:700;color:${marginColor};border-bottom:1px solid #f1f5f9;text-align:right;">${c.margin}%</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="padding:8px 12px;font-size:0.75rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;text-align:left;border-bottom:1px solid #e2e8f0;">Kategori</th>
          <th style="padding:8px 12px;font-size:0.75rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;text-align:right;border-bottom:1px solid #e2e8f0;">Sales</th>
          <th style="padding:8px 12px;font-size:0.75rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;text-align:right;border-bottom:1px solid #e2e8f0;">Profit</th>
          <th style="padding:8px 12px;font-size:0.75rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;text-align:right;border-bottom:1px solid #e2e8f0;">Margin</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Pembaruan Data Dashboard 
function updateDashboard(selectedRegion) {
  let filteredData = rawData;
  
  if (selectedRegion && selectedRegion !== 'All') {
    filteredData = rawData.filter(d => d.region.toLowerCase() === selectedRegion.toLowerCase());
  }

  // 1. Re-kalkulasi Angka Utama Kartu
  summaryStats = computeSummary(filteredData);
  displaySummaryCards(summaryStats);

  // 2. Kirim parameter threshold aktif ke detektor anomali
  if (typeof detectAllAnomalies === "function") {
    currentAnomalies = detectAllAnomalies(filteredData, zScoreThreshold, momThreshold);
  } else {
    currentAnomalies = {};
  }
  
  // Hitung akumulasi badge status tingkat keparahan
  let severeCount = 0;
  let warningCount = 0;

  const loops = [currentAnomalies.profitOutliers, currentAnomalies.momSpikes, currentAnomalies.regionOutliers];
  loops.forEach(arr => {
    if (arr) arr.forEach(a => {
      if (a.severity === 'severe') severeCount++;
      if (a.severity === 'warning') warningCount++;
    });
  });

  if (currentAnomalies.iqrOutliers?.bySubcat) {
    currentAnomalies.iqrOutliers.bySubcat.forEach(a => {
      if (a.severity === 'severe') severeCount++;
      if (a.severity === 'warning') warningCount++;
    });
  }

  const bSevere = document.getElementById('badge-severe');
  const bWarning = document.getElementById('badge-warning');
  if (bSevere) bSevere.textContent = severeCount + ' Kritis';
  if (bWarning) bWarning.textContent = warningCount + ' Peringatan';

  renderRawAnomalies(currentAnomalies);

  // 3. Re-draw Grafik D3.js dengan Canvas bersih
  const anomalyMap = buildAnomalyMap(currentAnomalies);
  renderCategoryChart(filteredData);
  renderRegionChart(filteredData);
  renderSubcatChart(filteredData, anomalyMap);

  // 3b. Render Ringkasan Performa per Kategori
  renderCategoryPerformanceSummary(summaryStats);

  // 4. Salurkan Event Sinyal Siap ke Sistem Eksternal / storyEngine
  dispatchDataReady(summaryStats);

  // 5. Otomatisasi Pembaharuan Jalur Narasi AI (SCR Engine Asinkron)
  triggerAILiveStory();
}

// Key untuk menyimpan hasil narasi AI terakhir di localStorage
const AI_STORY_CACHE_KEY = 'aiStoryCache';

function loadCachedStory() {
  try {
    const cached = JSON.parse(localStorage.getItem(AI_STORY_CACHE_KEY) || 'null');
    if (!cached) return;

    if (cached.title) {
      const el = document.getElementById('narrative-title');
      if (el) { el.textContent = cached.title + ' (cache)'; }
    }
    if (cached.setup)      fillZone('setup-text', cached.setup, true);
    if (cached.conflict)   fillZone('conflict-text', cached.conflict, true);
    if (cached.resolution) fillZone('resolution-text', cached.resolution, true);
    if (cached.insight) {
      const el = document.getElementById('insight-output');
      if (el) el.innerHTML = formatInsight(cached.insight) +
        '<p style="color:#94a3b8;font-size:12px;margin-top:8px;">⏳ Menampilkan hasil sebelumnya, sedang memperbarui...</p>';
    }
  } catch (e) {
    console.warn('Gagal membaca cache narasi AI:', e);
  }
}

// Simpan hasil narasi AI yang baru berhasil dibuat ke localStorage
function saveStoryCache(data) {
  try {
    const existing = JSON.parse(localStorage.getItem(AI_STORY_CACHE_KEY) || '{}');
    localStorage.setItem(AI_STORY_CACHE_KEY, JSON.stringify({ ...existing, ...data }));
  } catch (e) {
    console.warn('Gagal menyimpan cache narasi AI:', e);
  }
}

// Fungsi Pemicu Otomatis Narasi AI Berdasarkan Threshold Baru
function triggerAILiveStory() {
  const titleEl = document.getElementById('narrative-title');
  if (titleEl && !titleEl.classList.contains('loaded')) {
    titleEl.textContent = "Sales Analytics Dashboard";
  }

  // 1. Tampilkan hasil sebelumnya 
  loadCachedStory();

  // 2. Tampilkan indikator loading di zona narasi
  ['setup-text', 'conflict-text', 'resolution-text'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('ai-loaded')) {
      el.innerHTML = '<span class="loading-p">⏳ Sedang membuat narasi AI... (mohon tunggu, ini memanggil LLM)</span>';
    }
  });

  Promise.allSettled([
    generateTitle(summaryStats, currentAnomalies),
    generateStory(summaryStats, currentAnomalies),
    getInsight(summaryStats, 'Berikan 3 insight paling penting dan rekomendasi konkret. Bahasa Indonesia.')
  ]).then(([titleR, storyR, insightR]) => {

    if (titleR.status === 'fulfilled') {
      const el = document.getElementById('narrative-title');
      if (el) { el.textContent = titleR.value.trim(); el.classList.add('loaded'); }
      saveStoryCache({ title: titleR.value.trim() });
    } else {
      console.error('generateTitle gagal:', titleR.reason);
    }

    if (storyR.status === 'fulfilled') {
      const scr = parseStoryResponse(storyR.value);
      fillZone('setup-text',      scr.setup);
      fillZone('conflict-text',   scr.conflict);
      fillZone('resolution-text', scr.resolution);
      saveStoryCache({ setup: scr.setup, conflict: scr.conflict, resolution: scr.resolution });
    } else {
      console.error('generateStory gagal:', storyR.reason);
      // Hanya tampilkan error jika belum ada cache yang ditampilkan
      ['setup-text', 'conflict-text', 'resolution-text'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('ai-loaded')) {
          el.innerHTML = `<span style="color:#dc2626;">⚠️ Gagal memuat narasi AI: ${storyR.reason.message}. ` +
            `Pastikan Ollama berjalan di ${CONFIG.OLLAMA_URL} (jalankan <code>ollama serve</code> dan ` +
            `<code>ollama pull ${CONFIG.OLLAMA_MODEL}</code>), atau ganti AI_PROVIDER ke 'groq' di config.js.</span>`;
        }
      });
    }

    if (insightR.status === 'fulfilled') {
      const el = document.getElementById('insight-output');
      if (el) el.innerHTML = formatInsight(insightR.value);
      saveStoryCache({ insight: insightR.value });
    } else {
      console.error('getInsight gagal:', insightR.reason);
      const el = document.getElementById('insight-output');
      if (el && !el.querySelector('.insight-text')) {
        el.innerHTML = `<p class="insight-placeholder" style="color:#dc2626;">⚠️ Gagal memuat insight AI: ${insightR.reason.message}</p>`;
      }
    }
  });
}

function fillZone(id, text, isCache = false) {
  const el = document.getElementById(id);
  if (!el || !text) return;
  el.textContent = text;
  if (!isCache) el.classList.add('ai-loaded');
}

function dispatchDataReady(stats) {
  window.dispatchEvent(new CustomEvent('capstone-data-ready', { detail: stats }));
}

// BAGIAN 3: CORE RENDERING CHARTS 
function renderCategoryChart(data) {
  d3.select('#chart-category').selectAll('*').remove();
  const margin = { top: 20, right: 60, bottom: 40, left: 90 };
  const containerWidth = document.getElementById('chart-category').clientWidth || 450;
  const w = containerWidth - margin.left - margin.right;
  const h = 200 - margin.top  - margin.bottom;

  const byCategory = d3.rollups(data, v => d3.sum(v, d => d.sales), d => d.category)
    .map(([cat, val]) => ({ category: cat, sales: val }))
    .sort((a, b) => b.sales - a.sales);

  const svg = d3.select('#chart-category').append('svg')
    .attr('width', w + margin.left + margin.right).attr('height', h + margin.top + margin.bottom)
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, d3.max(byCategory, d => d.sales) || 0]).range([0, w]);
  const y = d3.scaleBand().domain(byCategory.map(d => d.category)).range([0, h]).padding(0.3);

  svg.selectAll('.bar').data(byCategory).enter().append('rect').attr('class', 'bar')
    .attr('x', 0).attr('y', d => y(d.category)).attr('width', d => x(d.sales)).attr('height', y.bandwidth())
    .attr('fill', '#2563eb').attr('rx', 4);

  svg.selectAll('.bar-label').data(byCategory).enter().append('text').attr('class', 'bar-label')
    .attr('x', d => x(d.sales) + 5).attr('y', d => y(d.category) + y.bandwidth() / 2).attr('dy', '.35em')
    .style('font-size', '11px').style('font-weight', '500').style('fill', '#374151')
    .text(d => `$${(d.sales / 1000).toFixed(1)}K`);

  svg.append('g').call(d3.axisLeft(y));
  svg.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickFormat(d => `$${(d/1000).toFixed(0)}K`));
}

function renderRegionChart(data) {
  d3.select('#chart-region').selectAll('*').remove();
  const margin = { top: 20, right: 60, bottom: 40, left: 90 };
  const containerWidth = document.getElementById('chart-region').clientWidth || 450;
  const w = containerWidth - margin.left - margin.right;
  const h = 220 - margin.top  - margin.bottom;

  const byRegion = d3.rollups(data, v => d3.sum(v, d => d.profit), d => d.region)
    .map(([r, p]) => ({ region: r, profit: p })).sort((a, b) => b.profit - a.profit);

  const svg = d3.select('#chart-region').append('svg')
    .attr('width', w + margin.left + margin.right).attr('height', h + margin.top + margin.bottom)
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const minProfit = d3.min(byRegion, d => d.profit) || 0;
  const maxProfit = d3.max(byRegion, d => d.profit) || 0;
  const x = d3.scaleLinear().domain([minProfit < 0 ? minProfit : 0, maxProfit]).range([0, w]);
  const y = d3.scaleBand().domain(byRegion.map(d => d.region)).range([0, h]).padding(0.3);

  svg.selectAll('.bar').data(byRegion).enter().append('rect')
    .attr('x', d => x(Math.min(0, d.profit))).attr('y', d => y(d.region))
    .attr('width', d => Math.abs(x(d.profit) - x(0))).attr('height', y.bandwidth())
    .attr('fill', d => {
      if (currentAnomalies.regionOutliers?.some(a => a.name === d.region)) return '#ea580c';
      return d.profit >= 0 ? '#10b981' : '#dc2626';
    }).attr('rx', 4);

  svg.selectAll('.bar-label-region').data(byRegion).enter().append('text').attr('class', 'bar-label-region')
    .attr('x', d => d.profit >= 0 ? x(d.profit) + 5 : x(0) + 5).attr('y', d => y(d.region) + y.bandwidth() / 2).attr('dy', '.35em')
    .style('font-size', '11px').style('font-weight', '500').style('fill', '#374151')
    .text(d => `$${(d.profit / 1000).toFixed(1)}K`);

  svg.append('g').call(d3.axisLeft(y));
  svg.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickFormat(d => `$${(d/1000).toFixed(0)}K`));
}

function renderSubcatChart(data, anomalyMap = new Map()) {
  d3.select('#chart-subcat').selectAll('*').remove(); 
  const margin = { top: 20, right: 60, bottom: 20, left: 150 };
  const containerWidth = document.getElementById('chart-subcat').clientWidth || 520;
  const w = containerWidth - margin.left - margin.right;
  
  const bySubcat = d3.rollups(data, v => {
    const s = d3.sum(v, d => d.sales);
    return s > 0 ? (d3.sum(v, d => d.profit) / s * 100) : 0;
  }, d => d.subcat || "Unknown").map(([name, val]) => ({ name, margin: +val.toFixed(1) })).sort((a, b) => a.margin - b.margin);

  const h = (bySubcat.length * 24) - margin.top - margin.bottom;
  const svg = d3.select('#chart-subcat').append('svg').attr('width', w + margin.left + margin.right).attr('height', h + margin.top + margin.bottom)
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const minMargin = d3.min(bySubcat, d => d.margin) || 0;
  const maxMargin = d3.max(bySubcat, d => d.margin) || 0;
  const x = d3.scaleLinear().domain([minMargin < 0 ? minMargin - 5 : 0, maxMargin + 5]).range([0, w]);
  const y = d3.scaleBand().domain(bySubcat.map(d => d.name)).range([0, h]).padding(0.25);

  svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', h).attr('stroke', '#64748b').attr('stroke-dasharray', '4,3').attr('stroke-width', 1.5);

  svg.selectAll('.bar').data(bySubcat).enter().append('rect').attr('class', 'bar')
    .attr('x', d => d.margin >= 0 ? x(0) : x(d.margin)).attr('y', d => y(d.name)).attr('width', d => Math.abs(x(d.margin) - x(0))).attr('height', y.bandwidth())
    .attr('fill', d => {
      if (!anomalyMap.has(d.name)) return '#94a3b8';
      const a = anomalyMap.get(d.name);
      return a.severity === 'severe' ? '#dc2626' : '#ea580c';
    });

  svg.selectAll('.label').data(bySubcat).enter().append('text')
    .attr('x', d => d.margin >= 0 ? x(d.margin) + 5 : x(d.margin) - 5).attr('y', d => y(d.name) + y.bandwidth() / 2)
    .attr('text-anchor', d => d.margin >= 0 ? 'start' : 'end').attr('dominant-baseline', 'middle')
    .style('font-size', '11px').style('font-weight', '600').style('fill', d => anomalyMap.has(d.name) ? '#dc2626' : '#374151')
    .text(d => `${d.margin}%`);

  svg.append('g').call(d3.axisLeft(y).tickSize(0)).selectAll('text').style('font-size', '11px').style('font-weight', '500').style('fill', '#1e293b');
  svg.select('.domain').remove();
}

// BAGIAN 4: UI MANIPULATION & ALERTS STREAM ENGINE
function displaySummaryCards(stats) {
  const salesNum = parseNum(stats.totalSales);
  const profitNum = parseNum(stats.totalProfit);

  const cards = [
    { label: 'Total Sales',   value: `$${(salesNum / 1000000).toFixed(2)}M` },
    { label: 'Total Profit',  value: profitNum >= 1000 ? `$${(profitNum / 1000).toFixed(0)}K` : `$${profitNum.toFixed(0)}` },
    { label: 'Profit Margin', value: `${stats.overallMargin}%` },
    { label: 'Total Orders',  value: stats.totalOrders ? stats.totalOrders.toLocaleString() : '0' }
  ];

  document.getElementById('summary-cards').innerHTML = cards.map(c => `
      <div class="summary-card">
        <div class="sc-label">${c.label}</div>
        <div class="sc-value">${c.value}</div>
      </div>`).join('');

  const modelName = CONFIG.AI_PROVIDER === 'ollama' ? CONFIG.OLLAMA_MODEL : CONFIG.GROQ_MODEL;
  const badge = document.getElementById('model-badge');
  if (badge) badge.textContent = modelName;
}

function renderRawAnomalies(anomalies) {
  const container = document.getElementById('alert-tab-raw');
  if (!container) return;
  const items = [];

  if (anomalies.profitOutliers) {
    anomalies.profitOutliers.forEach(a => items.push({
      severity: a.severity, label: `Profit Margin Anomali: ${a.name}`,
      detail: `margin ${a.margin}%  |  Z-score ${a.zScore}  |  ${a.direction === 'low' ? 'jauh di bawah' : 'jauh di atas'} rata-rata`
    }));
  }
  if (anomalies.momSpikes) {
    anomalies.momSpikes.forEach(a => items.push({
      severity: a.severity, label: `Revenue ${a.direction === 'drop' ? 'Turun' : 'Naik'} Drastis: ${a.month}`,
      detail: `${a.changePct}% MoM  |  $${Number(a.current).toLocaleString()} vs $${Number(a.previous).toLocaleString()} bulan lalu`
    }));
  }
  if (anomalies.iqrOutliers?.bySubcat) {
    anomalies.iqrOutliers.bySubcat.forEach(a => items.push({
      severity: a.severity, label: `Distribusi Tidak Normal: ${a.subcat}`,
      detail: `${a.count} transaksi outlier  |  rata-rata $${Number(a.avgSales).toLocaleString()}`
    }));
  }
  if (anomalies.regionOutliers) {
    anomalies.regionOutliers.forEach(a => items.push({
      severity: a.severity, label: `Region di Bawah Rata-rata: ${a.name}`,
      detail: `Margin ${a.margin}%  |  Z-score ${a.zScore}`
    }));
  }

  if (items.length === 0) {
    container.innerHTML = '<p class="placeholder-text">Tidak ada anomali signifikan pada threshold ini.</p>';
    return;
  }
  container.innerHTML = items.map(i => `
    <div class="alert-item">
      <div class="ai-dot ${i.severity}"></div>
      <div><div class="ai-label">${i.label}</div><div class="ai-detail">${i.detail}</div></div>
    </div>`).join('');
}

function buildAnomalyMap(anomalies) {
  const map = new Map();
  if (!anomalies || !anomalies.profitOutliers) return map;
  anomalies.profitOutliers.forEach(a => map.set(a.name, { severity: a.severity, zScore: a.zScore }));
  return map;
}

// BAGIAN 5: GATEWAY KONEKTIVITAS LLM GENERATIVE AI 
async function requestInsight() {
  const btn = document.getElementById('btn-insight');
  const output = document.getElementById('insight-output');
  const question = document.getElementById('custom-question').value.trim();
  if (!btn || !output) return;

  btn.disabled = true; btn.textContent = 'Memproses...';
  output.innerHTML = `<div class="insight-loading"><div class="spinner"></div><span>Mengirim kluster data via LLM...</span></div>`;

  try {
    const payloadContext = { ...summaryStats, anomalies: currentAnomalies };
    const result = await getInsight(payloadContext, question);
    output.innerHTML = `<div class="insight-text">${formatInsight(result)}</div>`;
  } catch (err) {
    output.innerHTML = `<div class="insight-error"><strong>Koneksi AI Terputus:</strong><br>${err.message}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Minta Insight →';
  }
}

function quickAsk(question) {
  const textarea = document.getElementById('custom-question');
  if (textarea) textarea.value = question;
  requestInsight();
}

async function requestAlertNarration() {
  const btn = document.getElementById('btn-narrate');
  const output = document.getElementById('ai-narration-output');
  if (!btn || !output) return;

  btn.disabled = true; btn.textContent = 'Memproses...';
  switchAlertTab('ai', document.querySelector('.alert-tabs .alert-tab:last-child'));
  output.innerHTML = `<p class="loading-text"><span class="spinner-inline"></span>Mengirim data ke AI...</p>`;

  try {
    const narration = await narrateAllAlerts(currentAnomalies);
    output.innerHTML = narration.split('\n').filter(l => l.trim())
      .map(l => `<div class="narration-line" style="margin-bottom:8px; line-height:1.5; color:#1e293b;">${l.replace(/\*\*/g,'')}</div>`).join('');
  } catch (err) {
    output.innerHTML = `<p style="color:#dc2626; font-weight:600;">Error: ${err.message}</p>`;
  } finally {
    btn.disabled = false; btn.textContent = '🤖 Narasi AI';
  }
}

async function triggerChartInsight(chartType) {
  if (!summaryStats || !summaryStats.categories) {
    alert("Data transaksi toko retail belum siap!"); return;
  }
  const outputDiv = document.getElementById('insight-output');
  if (outputDiv) outputDiv.innerHTML = `<div class="insight-loading"><div class="spinner"></div><span>Sedang menjalankan interpretasi AI...</span></div>`;

  try {
    const combinedContext = { ...summaryStats, anomalies: currentAnomalies };
    const insightResult = await getInsightForChart(chartType, combinedContext);
    let dataSummaryHtml = '';

    if (chartType === 'category') {
      const bikesSales = (summaryStats.categories.find(c => c.category === 'Bikes')?.sales / 1000 || 0).toFixed(1);
      const accSales = (summaryStats.categories.find(c => c.category === 'Accessories')?.sales / 1000 || 0).toFixed(1);
      const clothSales = (summaryStats.categories.find(c => c.category === 'Clothing')?.sales / 1000 || 0).toFixed(1);
      dataSummaryHtml = `
        <div style="background: #f8fafc; padding: 14px; border-radius: 8px; margin-bottom: 20px; font-size: 0.9rem; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6;">
          <strong style="color: #0f172a; display: block; margin-bottom: 6px;">Ringkasan Angka Grafik:</strong>
          <ul style="margin: 0; padding-left: 18px; color: #334155; line-height: 1.5;">
            <li><strong>Bikes:</strong> $${bikesSales}K</li>
            <li><strong>Accessories:</strong> $${accSales}K</li>
            <li><strong>Clothing:</strong> $${clothSales}K</li>
          </ul>
        </div>`;
    }

    if (outputDiv) {
      outputDiv.innerHTML = `
        <div class="insight-text" style="font-family: sans-serif;">
          ${dataSummaryHtml}
          <div style="font-size: 0.95rem; color: #1e293b;">
            <div style="font-weight: 700; margin-bottom: 12px; color: #0f172a;">🧠 Rekomendasi AI Insight:</div>
            <div style="line-height: 1.6; color: #334155;">${formatInsight(insightResult)}</div>
          </div>
        </div>`;
    }
  } catch (error) {
    if (outputDiv) outputDiv.innerHTML = `<div class="insight-error"><strong>Gagal memuat analisis:</strong><br>${error.message}</div>`;
  }
}

function mdBoldToHtml(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function formatInsight(text) {
  if (!text) return '';
  return text.split('\n').map(line => {
    line = line.trim();
    if (!line) return '<br>';
    const bulletMatch = line.match(/^(?:\d+\.|[-*•])\s+(.*)$/);
    if (bulletMatch) {
      return `<p class="insight-point" style="margin: 4px 0; padding-left: 8px;">${mdBoldToHtml(bulletMatch[1])}</p>`;
    }

    if (line.match(/^[A-Z**]/)) return `<p class="insight-head" style="font-weight: 700; margin-top: 12px; color:#0f172a;">${mdBoldToHtml(line).replace(/\*\*/g, '')}</p>`;
    return `<p style="margin: 4px 0;">${mdBoldToHtml(line)}</p>`;
  }).join('');
}

function switchAlertTab(tab, btnEl) {
  document.querySelectorAll('.alert-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.alert-tab-content').forEach(c => c.style.display = 'none');
  if (btnEl) btnEl.classList.add('active');
  const target = document.getElementById('alert-tab-' + tab);
  if (target) target.style.display = 'block';
}