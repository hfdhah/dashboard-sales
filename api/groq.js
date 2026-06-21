// api/groq.js
// meneruskan request ke Groq tanpa pernah
// mengirim API key ke browser. Key disimpan sebagai Environment Variable

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY belum diset di environment variables server.' });
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(req.body)
    });

    const data = await groqRes.json();
    return res.status(groqRes.status).json(data);

  } catch (err) {
    console.error('Proxy ke Groq gagal:', err);
    return res.status(502).json({ error: 'Gagal menghubungi Groq API.' });
  }
}