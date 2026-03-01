# Student Loan Pro — v2 Setup Guide

## What Changed in This Update

### 🔑 AI Advisor: Gemini → Claude (Anthropic)
The Gemini API was hitting quota limits because the free tier is very restrictive.
**Claude API has no daily quota limit** — you pay per token (extremely cheap for this use case).

**Action needed:**
1. Get a free API key at → https://console.anthropic.com
2. In your Vercel project: **Settings → Environment Variables**
3. Add: `ANTHROPIC_API_KEY` = `sk-ant-...your-key...`
4. Remove the old `GEMINI_API_KEY` variable
5. Redeploy

### ⚡ Bank Rates: Gemini → Static JSON
`api/rates.js` now returns hardcoded rates instantly — no API call, no quota, no latency.
Gemini was already returning a hardcoded template anyway (it had no real-time web access).
Update rates manually in `api/rates.js` when RBI changes the repo rate.

### 📊 Loan Calculator Logic
- Aligned compound interest tracking with the correct formula
- `compoundingEffect` now visible in amortization
- Grace period payment calculation fixed (reduces principal correctly)

### 💹 Investment Simulator — Performance Fix
- **FD calculation**: replaced O(n²) loop with O(1) closed-form formula → instant recalculation
- **Mutual Fund CAGR**: switched from index-based (broken for newer funds) to date-based calculation
- MF selection now recalculates in <100ms instead of 1-2 seconds

### 💰 New: Prepayment Calculator Tab
- Enter a lump sum + which year to apply it
- See exact interest saved, months cut, new payoff date
- Break-even analysis: prepayment vs investing the same amount at 12% equity returns

---

## Local Development

```bash
npm install -g vercel
cd student-loan-v2
vercel dev
```

Then open http://localhost:3000

## Environment Variables

| Variable | Purpose | Where to get |
|----------|---------|--------------|
| `ANTHROPIC_API_KEY` | AI Advisor (Claude) | https://console.anthropic.com |

## File Structure

```
api/
  advice.js    ← Claude AI advisor endpoint
  rates.js     ← Static bank rates (update manually)
app.js         ← All frontend logic
index.html     ← UI structure
style.css      ← Styling
```
