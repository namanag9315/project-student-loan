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

  const { summary } = req.body;
  if (!summary) return res.status(400).json({ error: 'Missing summary in request body' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in Vercel environment variables.' });
  }

  const body = JSON.stringify({
    systemInstruction: {
      parts: [{
        text: "You are an expert Indian student loan financial advisor specializing in IIM education loans. Use emojis as section headers (💡🏦📊💰🎯). Be specific with numbers from user data. Focus on: Section 80E deduction strategy, prepayment impact, bank rate negotiation, investment vs prepayment trade-off, EMI burden as % of expected IIM salary (avg ₹25–35L CTC). Keep under 700 words. Plain text with newlines."
      }]
    },
    contents: [{
      parts: [{ text: 'Give personalized financial advice for this IIM student loan:\n\n' + summary }]
    }],
    generationConfig: { temperature: 0.7 }
  });

  let lastError = null;

  for (const model of MODELS) {
    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey,
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
      return res.status(200).json(data);

    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  return res.status(429).json({
    error: 'quota',
    detail: lastError || 'All Gemini models quota exhausted or unavailable. Check your API key and quota.'
  });
}