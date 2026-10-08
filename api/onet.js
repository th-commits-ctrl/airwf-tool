// api/onet.js  —  Vercel Serverless Function
// Searches the official O*NET Web Services (v2) for occupations matching a job title.
// O*NET understands thousands of alternate job titles (e.g. "software engineer" -> Software Developers).
// Your O*NET API key stays here on the server; it never reaches the browser.
//
// The browser sends: { "keyword": "registered nurse" }
// and gets back:     { "occupations": [ { "code": "29-1141.00", "title": "Registered Nurses" }, ... ] }

const ONET_BASE = "https://api-v2.onetcenter.org/";

async function getSignedInUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!token || !url || !key) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ONET_API_KEY) {
    return res.status(500).json({ error: "O*NET is not set up yet. Add ONET_API_KEY in Vercel." });
  }

  const user = await getSignedInUser(req);
  if (!user) return res.status(401).json({ error: "Please sign in again." });

  const keyword = String(req.body?.keyword || "").trim().slice(0, 200);
  if (!keyword) return res.status(400).json({ error: "Enter a job title to search." });

  try {
    const url = ONET_BASE + "online/search?" + new URLSearchParams({ keyword, end: 10 }).toString();
    const r = await fetch(url, {
      headers: { "X-API-Key": process.env.ONET_API_KEY, Accept: "application/json", "User-Agent": "airwf-tool/1.2 (bot)" },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
      const msg = typeof data.error === "string" ? data.error : data.error?.message;
      return res.status(502).json({ error: msg || `O*NET request failed (${r.status})` });
    }
    const occupations = (data.occupation || []).map((o) => ({ code: o.code, title: o.title }));
    return res.status(200).json({ occupations });
  } catch (err) {
    console.error("O*NET proxy error:", err);
    return res.status(502).json({ error: "Could not reach O*NET." });
  }
}
