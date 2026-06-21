// aiInsight.js
// Modul untuk komunikasi dengan LLM (Groq)

// ── Build prompt dari ringkasan data ─────────────────────────
function buildPrompt(stats, focusQuestion = '') {
  const catLines = (stats.categories || [])
    .map(c => `   - Kategori ${c.category}: Total Sales $${(c.sales/1000).toFixed(1)}K, Total Profit $${(c.profit/1000).toFixed(1)}K`)
    .join('\n');

  const context = `
[KONTEKS DATA: DASHBOARD RETAIL SEPEDA & PAKAIAN OLAHRAGA]
Dilarang keras berhalusinasi tentang makanan, ampas tahu, pertanian, atau kuliner!

DATA PENJUALAN:
  - Total Sales Toko : $${(Number(stats.totalSales || 0)/1000000).toFixed(2)}M
  - Total Profit Toko: $${(Number(stats.totalProfit || 0)/1000).toFixed(0)}K

PERFORMA PER KATEGORI (Urutan dari Sales Terbesar):
${catLines}

FAKTA UTAMA DASHBOARD:
  - Kategori Terlaris (Sales Tertinggi Mutlak): Bikes
  - Kategori Terkecil (Sales Terendah): Clothing
`;

  const question = focusQuestion ||
    'Sebutkan 3 insight bisnis singkat dari data di atas. ' +
    'Fokuskan rekomendasi pada kategori BIKES karena penjualannya paling mendominasi. Gunakan Bahasa Indonesia yang singkat dan padat.';

  return context + '\n---\nPertanyaan: ' + question;
}

// ── Implementasi Groq ─────────────────────────────────────────
async function callGroq(prompt) {
  // Tidak ada header Authorization di sini — key Groq ditambahkan di sisi
  // server oleh api/groq.js, bukan dari browser.
  const res = await fetch(CONFIG.GROQ_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      model: CONFIG.GROQ_MODEL,
      messages: [
        {
          role:    'system',
          content: 'Kamu adalah analis data bisnis retail yang fokus pada penjualan produk sepeda, aksesoris, dan pakaian olahraga. ' +
                   'Berikan insight yang singkat, praktis, dan 100% berbasis data yang dikirimkan. ' +
                   'Dilarang keras berhalusinasi tentang produk makanan, kuliner, atau pertanian! Gunakan Bahasa Indonesia.'
        },
        {
          role:    'user',
          content: prompt
        }
      ],
      max_tokens:  500,
      temperature: 0.1
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Groq error: ${err.error?.message || res.status}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── Panggil Groq untuk insight utama
async function getInsight(stats, focusQuestion = '') {
  const prompt = buildPrompt(stats, focusQuestion);
  return await callGroq(prompt);
}

// ── Insight spesifik per Chart
async function getInsightForChart(chartType, stats) {
  let specificPrompt = '';

  if (chartType === 'category') {
    const catLines = (stats.categories || [])
      .map(c => `   - Kategori ${c.category}: Sales $${(c.sales/1000).toFixed(1)}K, Profit $${(c.profit/1000).toFixed(1)}K`)
      .join('\n');

    specificPrompt = `
Kamu adalah analis produk retail. Berikan analisis SINGKAT (maksimal 2 poin) hanya mengenai performa kategori barang berdasarkan data ini:
${catLines}
JANGAN membahas tentang wilayah/region atau hal lain! Gunakan Bahasa Indonesia.`;

  } else if (chartType === 'region') {
    const regionLines = (stats.regions || [])
      .map(r => `   - Negara/Wilayah ${r.region}: Total Penjualan $${(r.sales/1000).toFixed(1)}K`)
      .join('\n');

    const topRegionName = stats.regions && stats.regions[0] ? stats.regions[0].region : 'United States';
    const bottomRegionName = stats.regions && stats.regions[stats.regions.length - 1] ? stats.regions[stats.regions.length - 1].region : '-';

    specificPrompt = `
[KONTEKS: ANALISIS GEOGRAFIS PENJUALAN RETAIL SEPEDA]
⚠️ ATURAN MUTLAK: JANGAN gunakan kata-kata aneh, rancu, atau typo! JANGAN membahas kategori produk/barang! Sebutkan nama negara dengan jelas.

DATA PENJUALAN PER WILAYAH:
${regionLines}

FAKTA UTAMA:
  - Wilayah dengan Penjualan Tertinggi Mutlak: ${topRegionName}
  - Wilayah dengan Penjualan Terendah: ${bottomRegionName}

Pertanyaan: Berikan 2 insight bisnis singkat mengenai performa penjualan antar negara ini. Sebutkan nama negara jagoannya (${topRegionName}) secara jelas di poin pertama! Gunakan Bahasa Indonesia yang baik, benar, baku, dan profesional.`;
  }

  return await callGroq(specificPrompt);
}

// ── Anomali spesifik
async function narrateAlert(anomaly) {
  const prompt = buildAlertPrompt(anomaly);
  return await callGroq(prompt);
}

// ── Build prompt untuk satu anomali
function buildAlertPrompt(anomaly) {
  let context = '';

  if (anomaly.margin !== undefined) {
    context = `
Sub-kategori produk "${anomaly.name}" memiliki profit margin ${anomaly.margin}%
yang sangat ${anomaly.direction === 'low' || anomaly.direction === 'down' ? 'rendah' : 'tinggi'} dibanding rata-rata
(Z-score: ${anomaly.zScore}, severity: ${anomaly.severity}).
Total profit untuk sub-kategori ini: $${anomaly.profit || 0}.`;
  }

  else if (anomaly.month !== undefined) {
    context = `
Revenue bulan ${anomaly.month} mengalami ${anomaly.direction === 'drop' ? 'penurunan' : 'kenaikan'}
sebesar ${Math.abs(anomaly.changePct)}% dibanding bulan sebelumnya (${anomaly.prevMonth || 'bulan lalu'}).
Revenue bulan ini: $${Number(anomaly.current || 0).toLocaleString()},
bulan lalu: $${Number(anomaly.previous || 0).toLocaleString()}.
Severity: ${anomaly.severity}.`;
  }

  else if (anomaly.subcat !== undefined) {
    context = `
Sub-kategori "${anomaly.subcat}" memiliki ${anomaly.count} transaksi yang bernilai
sangat ${anomaly.direction === 'high' ? 'tinggi' : 'rendah'} secara statistik (outlier IQR).
Rata-rata nilai transaksi outlier: $${(anomaly.avgSales || 0).toLocaleString()}.`;
  }

  return `Kamu adalah analis data bisnis. Berikan ALERT singkat (maksimal 2 kalimat) 
dalam Bahasa Indonesia tentang anomali berikut di data penjualan retail dashboard:
${context}

Format alert: mulai dengan angka kunci yang mengejutkan, jelaskan implikasinya,
dan sertakan satu rekomendasi tindakan konkret.
Jangan gunakan kata "Alert:" di awal. Langsung ke poin.`;
}

// ── Narasi batch: generate alert untuk semua anomali
async function narrateAllAlerts(anomalies) {
  const profitOutliers = anomalies.profitOutliers || [];
  const momSpikes = anomalies.momSpikes || [];
  const iqrOutliers = (anomalies.iqrOutliers && anomalies.iqrOutliers.bySubcat) ? anomalies.iqrOutliers.bySubcat : [];
  const allItems = [];

  profitOutliers.forEach(a => {
    allItems.push({ kind: 'profit', severity: a.severity, text: `Sub-kategori ${a.name}: margin ${a.margin}% (Z=${a.zScore})` });
  });

  momSpikes.slice(0, 3).forEach(a => {
    allItems.push({ kind: 'mom', severity: a.severity, text: `Revenue ${a.month}: ${a.changePct}% MoM` });
  });

  iqrOutliers.slice(0, 2).forEach(a => {
    allItems.push({ kind: 'iqr', severity: a.severity, text: `IQR outlier di ${a.subcat} (${a.count} transaksi)` });
  });

  if (allItems.length === 0) return 'Tidak ada anomali signifikan terdeteksi.';

  const itemLines = allItems.map((item, i) => {
    return `${i + 1}. [${item.severity.toUpperCase()}] ${item.text}`;
  }).join('\n');

  const prompt = `Kamu adalah analis data bisnis yang memberi alert singkat dan dapat ditindaklanjuti (actionable).
Berikut adalah daftar anomali yang terdeteksi di data penjualan retail sepeda dan aksesoris olahraga:

${itemLines}

Untuk setiap anomali, tulis satu kalimat alert dalam Bahasa Indonesia.
Format wajib untuk setiap baris output: "• [Nama Item/Bulan]: [Fakta mengejutkan angka data] — [Rekomendasi tindakan dengan 1 kata kerja]"
Urutkan dari yang paling kritis. Jangan ada teks pembuka (preamble) atau penutup, langsung keluarkan daftar list poin tersebut.`;

  return await callGroq(prompt);
}