// Valid Gemini models for generateContent 
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-pro'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in Vercel environment variables.' });
  }

  const body = JSON.stringify({
    systemInstruction: {
      parts: [{
        text: `You are a live financial data assistant. Return ONLY valid JSON with no markdown and no extra text. Use the exact structure below, but you MUST REPLACE the placeholder "0.0" values with the ACTUAL, REAL-TIME rates you find on the web today:
{"repoRate":0.0,"rbi_note":"Brief note on latest RBI meeting","banks":[{"bank":"SBI Scholar","rate":0.0},{"bank":"Union Bank","rate":0.0},{"bank":"Bank of Baroda","rate":0.0},{"bank":"Punjab Natl Bank","rate":0.0},{"bank":"Canara Vidya Turant","rate":0.0},{"bank":"HDFC Credila","rate":0.0},{"bank":"IDFC FIRST","rate":0.0},{"bank":"Axis Bank","rate":0.0},{"bank":"Avanse","rate":0.0}],"lastUpdated":"YYYY-MM-DD"}`
      }]
    },
    contents: [{
      parts: [{
        text: 'Search the web for the current RBI Repo Rate in India, and the absolute latest education loan interest rates for SBI Scholar, Union Bank, Bank of Baroda, PNB, Canara Vidya Turant, HDFC Credila, IDFC FIRST, Axis Bank, and Avanse. Fill the JSON template with this live data.'
      }]
    }],
    // THIS IS THE MAGIC LINE: It enables real-time Google Search for the AI
    tools: [
      { googleSearch: {} }
    ],
    generationConfig: { temperature: 0.1 }
  });

  let lastError = null;

  for (const model of MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
      );

      const data = await response.json();

      if (response.status === 429 || data?.error?.code === 429) {
        lastError = data?.error?.message || 'Quota exceeded';
        console.warn(`[${model}] quota exceeded, trying next…`);
        continue;
      }
      if (!response.ok) {
        lastError = data?.error?.message || `HTTP ${response.status}`;
        console.warn(`[${model}] error: ${lastError}`);
        continue;
      }

      // Validate JSON in response
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) { lastError = 'Empty response'; continue; }

      const cleaned = rawText.replace(/```json|```/g, '').trim();
      JSON.parse(cleaned); // throws if not valid JSON

      data.candidates[0].content.parts[0].text = cleaned;
      return res.status(200).json(data);

    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  return res.status(429).json({
    error: 'quota',
    detail: lastError || 'All Gemini models quota exhausted or unavailable.'
  });
}
