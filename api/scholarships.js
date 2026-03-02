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
        text: `You are a scholarship discovery assistant for India. Search the web and return ONLY valid JSON with no markdown.
Output format:
{"lastUpdated":"YYYY-MM-DD","scholarships":[{"name":"","state":"All India","caste":["All"],"incomeLimit":800000,"maxSupport":"","level":["UG","PG"]}]}
Rules:
- Return at least 10 latest active scholarships.
- Normalize level values to UG, PG, MBA.
- incomeLimit must be numeric in INR.
- caste must be an array.`
      }]
    },
    contents: [{
      parts: [{ text: 'Find latest scholarships in India for higher education (UG/PG/MBA), including central and state schemes, and return clean JSON only.' }]
    }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.2 }
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
        continue;
      }
      if (!response.ok) {
        lastError = data?.error?.message || `HTTP ${response.status}`;
        continue;
      }

      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        lastError = 'Empty response';
        continue;
      }

      const cleaned = rawText.replace(/```json|```/g, '').trim();
      JSON.parse(cleaned);
      data.candidates[0].content.parts[0].text = cleaned;
      return res.status(200).json(data);
    } catch (err) {
      lastError = err.message;
    }
  }

  return res.status(429).json({
    error: 'quota',
    detail: lastError || 'All Gemini models quota exhausted or unavailable.'
  });
}
