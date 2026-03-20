# AI Transformation Profile Tool
### Based on the JFF AI-Ready Workforce Framework

---

## Project structure

```
airwf-tool/
├── api/
│   └── claude.js              ← Vercel serverless proxy
├── netlify/
│   └── functions/
│       └── claude.js          ← Netlify serverless proxy (alternative)
├── src/
│   ├── main.jsx
│   └── App.jsx                ← The full React app
├── public/
├── index.html
├── package.json
├── vite.config.js
├── netlify.toml               ← Netlify config (only needed for Netlify)
├── .env.example               ← Copy to .env.local and fill in values
└── .gitignore
```

---

## Deploy to Vercel (recommended)

### 1. Install dependencies and test locally
```bash
npm install
cp .env.example .env.local
# Edit .env.local — add your ANTHROPIC_API_KEY
npm run dev
```
Visit http://localhost:5173. The proxy runs at /api/claude.

### 2. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/airwf-tool.git
git push -u origin main
```

### 3. Connect to Vercel
1. Go to https://vercel.com → New Project → Import your repo
2. Vercel auto-detects Vite — no build settings needed
3. Add environment variables in the Vercel dashboard:
   - `ANTHROPIC_API_KEY` → your key (sk-ant-...)
   - `VITE_API_URL` → /api/claude
   - `ALLOWED_ORIGIN` → https://your-app.vercel.app  (tighten CORS in production)
4. Click Deploy

Every git push to main auto-redeploys.

---

## Deploy to Netlify (alternative)

### 1. Install dependencies and test locally
```bash
npm install
npm install -g netlify-cli
cp .env.example .env.local
# Edit .env.local — add your ANTHROPIC_API_KEY
netlify dev
```
Visit http://localhost:8888. The function runs at /.netlify/functions/claude.

### 2. Update .env.local for Netlify
```
VITE_API_URL=/.netlify/functions/claude
```

### 3. Push to GitHub (same as Vercel step 2 above)

### 4. Connect to Netlify
1. Go to https://app.netlify.com → Add new site → Import from Git
2. Build command: `npm run build`  |  Publish directory: `dist`
3. Add environment variables in Site settings → Environment variables:
   - `ANTHROPIC_API_KEY` → your key
   - `VITE_API_URL` → /.netlify/functions/claude
   - `ALLOWED_ORIGIN` → https://your-app.netlify.app
4. Click Deploy site

---

## Tightening security for production

In `api/claude.js` (Vercel) or `netlify/functions/claude.js` (Netlify), change:

```js
// Replace the wildcard:
res.setHeader("Access-Control-Allow-Origin", "*");

// With your actual domain:
res.setHeader("Access-Control-Allow-Origin", "https://your-app.vercel.app");
```

Also set `ALLOWED_ORIGIN` in your hosting dashboard environment variables.

---

## Adding rate limiting (optional but recommended)

For a public-facing app, add a simple per-IP rate limit to the proxy using
Vercel's `@vercel/kv` or Netlify's built-in rate limiting to prevent
unexpected Anthropic API charges.
