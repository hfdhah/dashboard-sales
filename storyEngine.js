// storyEngine.js
// Menyusun narasi SCR dashboard dari summary + anomali

// generate full story 
async function generateStory(summary, anomalies, zScoreThreshold = 1.5, momThreshold = 25) {
  const prompt = buildStoryPrompt(summary, anomalies, zScoreThreshold, momThreshold);
  if (CONFIG.AI_PROVIDER === 'ollama') return await callOllama(prompt);
  return await callGroq(prompt);
}

// generate judul naratif untuk dashboard
async function generateTitle(summary, anomalies, zScoreThreshold = 1.5, momThreshold = 25) {
  const severeCount = anomalies.profitOutliers.filter(a => a.severity === 'severe').length
    + anomalies.momSpikes.filter(a => a.severity === 'severe').length;

  const worstAnomaly = anomalies.profitOutliers[0]
    || anomalies.momSpikes[0]
    || null;

  const context = `
Data Performa Penjualan (Sales Performance):
- Total Sales: $${summary.totalSales}, Profit Margin: ${summary.overallMargin}%
- Konfigurasi Radar AI Aktif -> Z-Score Threshold: ${zScoreThreshold}, MoM Threshold: ${momThreshold}%
- Anomali kritis terdeteksi dengan radar ini: ${severeCount}
${worstAnomaly ? '- Anomali terparah yang menembus batas: ' + JSON.stringify(worstAnomaly) : ''}`;

  const prompt = context + `

Tulis SATU judul dashboard dalam Bahasa Indonesia.
Judul harus naratif (mengandung insight, bukan deskriptif).
Maksimal 12 kata. Format: fakta kunci + implikasi atau rekomendasi.
Contoh baik: "Margin Turun 3 Kuartal Berturut — Kategori Tables Jadi Penyebab Utama"
Contoh buruk: "Dashboard Penjualan Global Q3 2026"
Hanya tulis judulnya saja, tanpa tanda kutip dan tanpa penjelasan lain.`;

  const raw = CONFIG.AI_PROVIDER === 'ollama' ? await callOllama(prompt) : await callGroq(prompt);
  return cleanTitle(raw);
}

function cleanTitle(raw) {
  if (!raw) return 'Sales Analytics Dashboard';
  let text = raw.trim();

  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const jawabanMatch = text.match(/jawaban\s*:\s*([\s\S]+)$/i);
  if (jawabanMatch) text = jawabanMatch[1].trim();

  const badKeywords = /tugas\s*:|format\s*:|contoh\s+(baik|buruk)|maksimal\s+\d+\s+kata|hanya\s+tulis|tanpa\s+tanda\s+kutip|judul\s+harus|berdasarkan\s+data\s+retail/i;
  text = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !badKeywords.test(l))
    .join(' ')
    .trim();

  text = text.split(/[\n\r]+/)[0];

  text = text.replace(/^["'“”]+|["'“”.\s]+$/g, '').trim();


  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 15) text = words.slice(0, 15).join(' ');

  return text || 'Sales Analytics Dashboard';
}

// build prompt untuk full story (SCR format) 
function buildStoryPrompt(summary, anomalies, zScoreThreshold = 1.5, momThreshold = 25) {
  const profitLines = anomalies.profitOutliers
    .map(a => `  - ${a.name}: margin ${a.margin}% (Z=${a.zScore}, ${a.severity})`)
    .join('\n') || '  Tidak ada';

  const momLines = anomalies.momSpikes
    .slice(0, 3)
    .map(a => `  - ${a.month}: ${a.changePct}% MoM (${a.severity})`)
    .join('\n') || '  Tidak ada';

  const catLines = summary.categories
    .map(c => `  - ${c.category}: sales $${(c.sales/1000).toFixed(0)}K, margin ${c.margin}%`)
    .join('\n');

  return `Kamu adalah analis bisnis senior yang menulis ringkasan eksekutif.
Berdasarkan data performa penjualan (sales data) berikut, tulis narasi bisnis dengan format SCR:

DATA KESELURUHAN:
  Total Sales: $${summary.totalSales}
  Total Profit: $${summary.totalProfit}
  Profit Margin: ${summary.overallMargin}%
  Total Orders: ${summary.totalOrders}

PENGATURAN AMBANG BATAS (THRESHOLD) RADAR ANALISIS:
  Z-Score Margin Threshold: ${zScoreThreshold} (Data di luar ini dianggap pencilan ekstrem)
  Month-over-Month Sales Threshold: ${momThreshold}% (Guncangan bulanan di atas angka ini dianggap Spikes/Drop)

PERFORMA PER KATEGORI:
${catLines}

ANOMALI PROFIT MARGIN YANG MENEMBUS THRESHOLD Z-SCORE (${zScoreThreshold}):
${profitLines}

ANOMALI PERUBAHAN BULANAN YANG MENEMBUS THRESHOLD MoM (${momThreshold}%):
${momLines}

Tulis narasi dalam Bahasa Indonesia dengan FORMAT PERSIS seperti ini:

**SETUP**
[1-2 kalimat konteks situasi bisnis saat ini]

**CONFLICT**
[1-2 kalimat masalah atau anomali paling kritis yang ditemukan berdasarkan threshold aktif]

**RESOLUTION**
[1-2 kalimat rekomendasi konkret yang bisa dilakukan]

Gunakan angka spesifik dari data. Maksimal 6 kalimat total. Langsung ke poin.`;
}

// parse respons LLM menjadi objek SCR
function parseStoryResponse(text) {
  const result = { setup: '', conflict: '', resolution: '', raw: text };

  const setupMatch    = text.match(/\*{0,2}SETUP\*{0,2}[\s\S]*?\n([\s\S]*?)(?=\*{0,2}CONFLICT|\*{0,2}RESOLUTION|$)/i);
  const conflictMatch = text.match(/\*{0,2}CONFLICT\*{0,2}[\s\S]*?\n([\s\S]*?)(?=\*{0,2}RESOLUTION|\*{0,2}SETUP|$)/i);
  const resolveMatch  = text.match(/\*{0,2}RESOLUTION\*{0,2}[\s\S]*?\n([\s\S]*?)(?=\*{0,2}SETUP|\*{0,2}CONFLICT|$)/i);

  if (setupMatch)    result.setup    = setupMatch[1].trim();
  if (conflictMatch) result.conflict   = conflictMatch[1].trim();
  if (resolveMatch)  result.resolution = resolveMatch[1].trim();

  if (!result.setup && !result.conflict && !result.resolution) {
    result.setup = text.trim();
  }

  result.setup      = cleanNarrativeText(result.setup);
  result.conflict   = cleanNarrativeText(result.conflict);
  result.resolution = cleanNarrativeText(result.resolution);

  return result;
}

// untuk teks naratif SCR bersih dari sisa label/markdown
function cleanNarrativeText(text) {
  if (!text) return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*\*{0,2}\s*(SETUP|CONFLICT|CONFLIK|RESOLUTION|RESOLUSI)\s*:?\s*\*{0,2}\s*/i, '')
    .replace(/\*\*/g, '')
    .trim();
}