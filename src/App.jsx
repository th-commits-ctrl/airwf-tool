import { useState, useCallback, useEffect } from "react";
import { supabase, supabaseConfigured } from "./supabaseClient.js";

const fontStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=DM+Sans:wght@400;500;600;700&display=swap');
  :root {
    --font-title: 'Playfair Display', Georgia, serif;
    --font-body:  'DM Sans', system-ui, sans-serif;
    --jff-red:    #E8442A;
    --jff-cyan:   #2BBFBF;
    --jff-yellow: #C8D400;
    --jff-black:  #231F20;
  }
  *, body { font-family: var(--font-body); box-sizing: border-box; }
  body { margin: 0; }
  input { font-family: var(--font-body); font-size: 14px; padding: 9px 13px; border: 1px solid #ddd; border-radius: 8px; outline: none; width: 100%; }
  input:focus { border-color: var(--jff-cyan); }
  button:focus-visible { outline: 2px solid var(--jff-cyan); outline-offset: 2px; }
  @media print {
    .no-print { display: none !important; }
    body, .page-bg { background: #fff !important; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .print-avoid-break { break-inside: avoid; }
  }
`;

// ─── Settings you may want to change ───────────────────────────────────────
const CLAUDE_API_URL = import.meta.env.VITE_API_URL || "/api/claude";
const MAX_TASKS = 10; // Most tasks to load into step 2 (Core tasks are always loaded first)
const AIRES_API_URL = "https://www.airesilience.org/ext/api";
const AUTOMATION_THRESHOLD = 0.5; // AI Resilience likelihood at/above this = "automate" group
// ───────────────────────────────────────────────────────────────────────────

// Sends a request to one of our server functions, including the signed-in user's pass.
async function authedPost(url, body) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Request failed: ${response.status}`);
  return json;
}

async function callClaude(messages, systemPrompt) {
  const data = await authedPost(CLAUDE_API_URL, { model: "claude-sonnet-5-5", max_tokens: 1000, system: systemPrompt, messages });
  return data.content?.map((b) => b.text || "").join("") || "";
}

// Fetches AI Resilience (airesilience.org) data for an occupation. Free, no key needed.
async function fetchAiResilience(code) {
  const tries = [code, code.split(".")[0]]; // e.g. "29-1141.00", then "29-1141"
  for (const c of tries) {
    const r = await fetch(`${AIRES_API_URL}/career/${encodeURIComponent(c)}`);
    if (r.status === 404) continue;
    const json = await r.json().catch(() => ({}));
    if (!r.ok || !json.success) throw new Error(json.error?.message || json.error || `AI Resilience request failed (${r.status})`);
    const d = json.data || {};
    return {
      code: d.code, name: d.name, url: d.url,
      label: d.aiResilience?.label || null, score: d.aiResilience?.score ?? null,
      tasks: (d.tasks || []).map((t) => ({ id: t.id == null ? null : String(t.id), task: t.task, automationLikelihood: t.automationLikelihood, taskType: t.taskType })),
    };
  }
  return null;
}

// Searches AI Resilience for detailed occupations matching a job title.
// If the full phrase finds nothing, it searches each word and ranks occupations matching the most words.
const STOP_WORDS = new Set(["and", "the", "for", "with", "of", "senior", "junior", "lead", "assistant", "associate", "head", "chief"]);
async function searchOccupations(title) {
  const run = async (q) => {
    const r = await fetch(`${AIRES_API_URL}/careers/search?q=${encodeURIComponent(q)}&level=detailed&limit=10`);
    const json = await r.json().catch(() => ({}));
    if (!r.ok || !json.success) throw new Error(json.error?.message || json.error || `Search failed (${r.status})`);
    return (json.data || []).map((d) => ({ code: d.code, title: d.name, label: d.aiResilience?.label || null }));
  };
  const phrase = title.trim();
  const full = await run(phrase);
  if (full.length) return full;

  const words = [...new Set(phrase.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w)))].slice(0, 4);
  const tally = new Map();
  for (const w of words) {
    for (const [i, occ] of (await run(w)).entries()) {
      const prev = tally.get(occ.code) || { occ, hits: 0, rank: 99 };
      tally.set(occ.code, { occ, hits: prev.hits + 1, rank: Math.min(prev.rank, i) });
    }
  }
  return [...tally.values()].sort((x, y) => y.hits - x.hits || x.rank - y.rank).slice(0, 10).map((x) => x.occ);
}

// Picks which tasks to load: Core tasks first, then Supplemental if there's room.
// AI Resilience lists tasks from most to least resilient, so when there are more tasks than room,
// we take an even spread across that list rather than the first few, to avoid skewing the results.
function selectTasks(tasks, max) {
  const spread = (list, n) => {
    if (list.length <= n) return list;
    const picked = [];
    for (let i = 0; i < n; i++) picked.push(list[Math.round((i * (list.length - 1)) / (n - 1 || 1))]);
    return picked;
  };
  const core = tasks.filter((t) => t.taskType === "Core");
  const supplemental = tasks.filter((t) => t.taskType !== "Core");
  const coreChosen = spread(core, max);
  return [...coreChosen, ...spread(supplemental, max - coreChosen.length)];
}

// AI Resilience "automate" -> Replace or Displace; "augment" -> Augment or Elevate
function airesGroup(likelihood) {
  return likelihood >= AUTOMATION_THRESHOLD
    ? { key: "automate", label: "Automate", allowed: ["replace", "displace"], text: "Replace or Displace" }
    : { key: "augment",  label: "Augment",  allowed: ["augment", "elevate"],  text: "Augment or Elevate" };
}
const pct = (n) => `${Math.round(n * 100)}%`;

const IMPACT_TYPES = [
  { key: "replace",    label: "Replace",    color: "#C0392B", bg: "#FDF0EE", desc: "Routine physical tasks fully automated by AI, significantly decreasing human use" },
  { key: "displace",   label: "Displace",   color: "#E8442A", bg: "#FEF3F1", desc: "Routine cognitive tasks increasingly performed by AI, decreasing human use" },
  { key: "complement", label: "Complement", color: "#1A9999", bg: "#E8F8F8", desc: "Machine collaboration tasks where AI works alongside humans with neutral impact" },
  { key: "augment",    label: "Augment",    color: "#8A9600", bg: "#F7F9CC", desc: "Complex cognitive tasks where AI increases human performance" },
  { key: "elevate",    label: "Elevate",    color: "#2BBFBF", bg: "#D4F2F2", desc: "Interpersonal/human tasks whose importance is significantly increased by AI" },
];

// Importance colors: green = very important, through to red = not important
const IMPORTANCE_COLORS = {
  very_important:     { c: "#5E8C1F", bg: "#EEF6E2" },
  important:          { c: "#1A9999", bg: "#E8F8F8" },
  somewhat_important: { c: "#B7791F", bg: "#FDF4E3" },
  not_important:      { c: "#C0392B", bg: "#FDF0EE" },
};

const IMPORTANCE_LEVELS = [
  { key: "very_important",     label: "Very Important",     score: 3 },
  { key: "important",          label: "Important",          score: 2 },
  { key: "somewhat_important", label: "Somewhat Important", score: 1 },
  { key: "not_important",      label: "Not Important",      score: 0 },
];

function getAction(impact, importance) {
  const high = importance === "very_important" || importance === "important";
  const low  = importance === "somewhat_important" || importance === "not_important";
  if ((impact === "replace" || impact === "displace" || impact === "complement") && high) return "future_proof";
  if ((impact === "augment" || impact === "elevate") && high)  return "capitalize";
  if ((impact === "replace" || impact === "displace" || impact === "complement") && low) return "automate";
  if ((impact === "augment" || impact === "elevate") && low)   return "reimagine";
  return "automate";
}

const ACTION_META = {
  future_proof: { label: "Future-Proof", color: "#C0392B", bg: "#FDF0EE", border: "#E8442A", desc: "Tasks at risk of displacement that are critical to this role. Act now to upskill workers or redefine responsibilities before AI takes over." },
  capitalize:   { label: "Capitalize",   color: "#1A9999", bg: "#E8F8F8", border: "#2BBFBF", desc: "Human and analytical strengths that AI will amplify. Double down — invest in developing these skills and find AI use cases that build on them." },
  automate:     { label: "Automate",     color: "#8A9600", bg: "#F7F9CC", border: "#C8D400", desc: "Tasks that aren't central to the role and can be handled by machines. Prioritize these for AI or automation solutions to free up human capacity." },
  reimagine:    { label: "Reimagine",    color: "#444",    bg: "#F5F5F5", border: "#999",    desc: "Human skills underutilized in this role today. Redesign the job to bring these capabilities forward as AI handles lower-value work." },
};

const QUADRANTS = [
  { key: "future_proof", label: "High importance + Complement / Replace / Displace", accent: "#E8442A" },
  { key: "capitalize",   label: "High importance + Augment / Elevate",               accent: "#2BBFBF" },
  { key: "automate",     label: "Low importance + Complement / Replace / Displace",  accent: "#C8D400" },
  { key: "reimagine",    label: "Low importance + Augment / Elevate",                accent: "#888"    },
];

const impactLabel = (k) => IMPACT_TYPES.find((t) => t.key === k)?.label || "";
const importanceLabel = (k) => IMPORTANCE_LEVELS.find((l) => l.key === k)?.label || "";

// JFF Logo as inline SVG — no image file needed
function JFFLogo() {
  return (
    <svg height="38" viewBox="0 0 300 80" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Jobs for the Future">
      <rect x="2" y="8" width="16" height="62" fill="#E8442A"/>
      <circle cx="20" cy="62" r="9" fill="#231F20"/>
      <rect x="28" y="4" width="16" height="66" fill="#2BBFBF"/>
      <circle cx="46" cy="44" r="10" fill="#231F20"/>
      <rect x="54" y="0" width="16" height="70" fill="#C8D400"/>
      <circle cx="70" cy="20" r="8" fill="#231F20"/>
      <text x="88" y="34" fontFamily="'DM Sans', sans-serif" fontWeight="700" fontSize="22" fill="#231F20">Jobs for</text>
      <text x="88" y="62" fontFamily="'DM Sans', sans-serif" fontWeight="700" fontSize="22" fill="#231F20">the Future</text>
    </svg>
  );
}

function Badge({ impact }) {
  const meta = IMPACT_TYPES.find((t) => t.key === impact);
  if (!meta) return null;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 4, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}50`, whiteSpace: "nowrap" }}>{meta.label}</span>;
}

function ImportanceBadge({ importance }) {
  const meta = IMPORTANCE_LEVELS.find((l) => l.key === importance);
  if (!meta) return null;
  const map = IMPORTANCE_COLORS;
  const { bg, c } = map[importance];
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 4, background: bg, color: c, border: `1px solid ${c}50`, whiteSpace: "nowrap" }}>{meta.label}</span>;
}

function ActionCard({ actionKey, tasks }) {
  const m = ACTION_META[actionKey];
  return (
    <div style={{ background: "#fff", border: `2px solid ${m.border}`, borderRadius: 12, padding: "1rem", minHeight: 130 }}>
      <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: m.bg, color: m.color, textTransform: "uppercase", letterSpacing: "0.08em", display: "inline-block", marginBottom: 8 }}>{m.label}</span>
      <p style={{ fontSize: 12, color: "#666", margin: "0 0 10px", lineHeight: 1.6 }}>{m.desc}</p>
      {tasks.length === 0
        ? <p style={{ fontSize: 12, color: "#bbb", fontStyle: "italic" }}>No tasks mapped here</p>
        : tasks.map((t, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: i < tasks.length - 1 ? "1px solid #f5f5f5" : "none" }}>
            <span style={{ fontSize: 13, color: "#231F20", flex: 1 }}>{t.task}</span>
            <Badge impact={t.impact} />
          </div>
        ))
      }
    </div>
  );
}

const btnPrimary = (on) => ({ background: on ? "#E8442A" : "#ddd", color: on ? "#fff" : "#aaa", border: "none", padding: "9px 22px", borderRadius: 8, cursor: on ? "pointer" : "not-allowed", fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 14 });
const btnSecondary = { background: "transparent", color: "#231F20", border: "1px solid #ccc", padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 14 };
const linkBtn = { background: "none", border: "none", padding: 0, color: "#1A9999", cursor: "pointer", fontSize: 13, fontFamily: "var(--font-body)", textDecoration: "underline" };
const card = { background: "#fff", border: "1px solid #EAEAE6", borderRadius: 12, padding: "1.5rem", marginBottom: "1.25rem" };
const h2Style = { fontFamily: "var(--font-title)", fontSize: 22, fontWeight: 500, margin: "0 0 6px", color: "#231F20" };

function Header({ email, onSignOut }) {
  return (
    <div className="no-print" style={{ background: "#fff", borderBottom: "1px solid #EAEAE6", padding: "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <JFFLogo />
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {email
          ? <>
              <span style={{ fontSize: 12, color: "#777" }}>{email}</span>
              <button onClick={onSignOut} style={{ ...btnSecondary, fontSize: 12, padding: "5px 12px" }}>Sign out</button>
            </>
          : <span style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em" }}>AI-Ready Workforce Framework</span>}
      </div>
    </div>
  );
}

function Hero() {
  return (
    <div style={{ background: "#231F20", padding: "28px 32px 22px" }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontSize: 28, fontWeight: 500, color: "#fff", margin: "0 0 6px", letterSpacing: "-0.01em" }}>AI Transformation Profile</h1>
      <p style={{ fontSize: 13, color: "#aaa", margin: "0 0 16px", lineHeight: 1.7, maxWidth: 520 }}>Apply the JFF AI-Ready Workforce Framework to map any role's tasks against AI impact — and build a clear action plan.</p>
      <div style={{ display: "flex", gap: 5 }}>
        {["#E8442A", "#2BBFBF", "#C8D400", "#555"].map((c) => <div key={c} style={{ height: 4, width: 28, borderRadius: 2, background: c }} />)}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div style={{ borderTop: "1px solid #EAEAE6", padding: "14px 32px", background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.05em" }}>Powered by the JFF AI-Ready Workforce Framework</span>
        <div style={{ display: "flex", gap: 5 }}>
          {["#E8442A", "#2BBFBF", "#C8D400"].map((c) => <div key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />)}
        </div>
      </div>
      <p style={{ fontSize: 11, color: "#999", margin: 0, lineHeight: 1.6, maxWidth: 720 }}>
        Occupation and task information is derived from the <a href="https://www.onetcenter.org/database.html" target="_blank" rel="noreferrer" style={{ color: "#1A9999" }}>O*NET database</a> by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), provided through AI Resilience. O*NET® is a trademark of USDOL/ETA.
      </p>
      <p style={{ fontSize: 11, color: "#999", margin: "4px 0 0", lineHeight: 1.6, maxWidth: 720 }}>
        Task automation data: <a href="https://www.airesilience.org" target="_blank" rel="noreferrer" style={{ color: "#1A9999" }}>AI Resilience Report</a> by <a href="https://www.careervillage.org" target="_blank" rel="noreferrer" style={{ color: "#1A9999" }}>CareerVillage.org</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" style={{ color: "#1A9999" }}>CC BY 4.0</a>.
      </p>
    </div>
  );
}

function Shell({ email, onSignOut, children }) {
  return (
    <>
      <style>{fontStyle}</style>
      <div className="page-bg" style={{ minHeight: "100vh", background: "#F8F8F6", display: "flex", flexDirection: "column" }}>
        <Header email={email} onSignOut={onSignOut} />
        <Hero />
        <div style={{ maxWidth: 780, width: "100%", margin: "0 auto", padding: "2rem 1.5rem", flex: 1 }}>{children}</div>
        <Footer />
      </div>
    </>
  );
}

// ─── Sign-in screen ────────────────────────────────────────────────────────
function AuthScreen({ recovery, onRecoveryDone }) {
  const [mode, setMode] = useState(recovery ? "reset" : "signin"); // signin | signup | forgot | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { type: "error" | "info", text }

  useEffect(() => { if (recovery) setMode("reset"); }, [recovery]);

  const switchMode = (m) => { setMode(m); setMessage(null); setPassword(""); };

  const friendly = (err) => {
    const t = err?.message || "";
    if (/invalid login/i.test(t)) return "That email and password don't match. Check them and try again.";
    if (/not confirmed/i.test(t)) return "Confirm your email first. Open the link we sent you, then sign in.";
    if (/already registered/i.test(t)) return "An account with this email already exists. Sign in instead.";
    return t || "Something went wrong. Try again.";
  };

  const submit = async () => {
    setMessage(null);
    const cleanEmail = email.trim();
    if (mode !== "reset" && !/^\S+@\S+\.\S+$/.test(cleanEmail)) return setMessage({ type: "error", text: "Enter a valid email address." });
    if ((mode === "signup" || mode === "reset") && password.length < 8) return setMessage({ type: "error", text: "Use a password with at least 8 characters." });
    if (mode === "signin" && !password) return setMessage({ type: "error", text: "Enter your password." });

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) {
          setMode("signin"); setPassword("");
          setMessage({ type: "info", text: `Account created. We sent a confirmation link to ${cleanEmail}. Open it, then sign in here.` });
        }
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: window.location.origin });
        if (error) throw error;
        setMessage({ type: "info", text: `If an account exists for ${cleanEmail}, a password reset link is on its way.` });
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        onRecoveryDone();
      }
    } catch (err) {
      setMessage({ type: "error", text: friendly(err) });
    }
    setBusy(false);
  };

  const titles = {
    signin: ["Sign in", "Sign in to build AI Transformation Profiles and return to the ones you've saved."],
    signup: ["Create your account", "Use your work email. Your saved profiles are private to your account."],
    forgot: ["Reset your password", "Enter the email you signed up with and we'll send you a reset link."],
    reset:  ["Choose a new password", "Enter a new password for your account."],
  };
  const buttonText = { signin: "Sign in", signup: "Create account", forgot: "Send reset link", reset: "Save new password" }[mode];

  return (
    <div style={{ maxWidth: 440, margin: "0 auto" }}>
      <div style={card}>
        <h2 style={h2Style}>{titles[mode][0]}</h2>
        <p style={{ fontSize: 13, color: "#777", margin: "0 0 1.25rem", lineHeight: 1.7 }}>{titles[mode][1]}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} onKeyDown={(e) => e.key === "Enter" && !busy && submit()}>
          {mode !== "reset" && (
            <label style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>
              Email
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginTop: 4 }} />
            </label>
          )}
          {mode !== "forgot" && (
            <label style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>
              {mode === "reset" ? "New password" : "Password"}
              <input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginTop: 4 }} />
              {(mode === "signup" || mode === "reset") && <span style={{ display: "block", fontWeight: 400, color: "#999", marginTop: 4 }}>At least 8 characters.</span>}
            </label>
          )}
        </div>

        {message && (
          <div role="status" style={{ marginTop: 14, borderRadius: 8, padding: "10px 14px", fontSize: 13, lineHeight: 1.6, background: message.type === "error" ? "#FDF0EE" : "#E8F8F8", color: message.type === "error" ? "#C0392B" : "#1A9999" }}>
            {message.text}
          </div>
        )}

        <button onClick={submit} disabled={busy} style={{ ...btnPrimary(!busy), width: "100%", marginTop: 16 }}>{busy ? "Please wait..." : buttonText}</button>

        <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          {mode === "signin" && <>
            <button style={linkBtn} onClick={() => switchMode("signup")}>Create an account</button>
            <button style={linkBtn} onClick={() => switchMode("forgot")}>Forgot password?</button>
          </>}
          {(mode === "signup" || mode === "forgot") && <button style={linkBtn} onClick={() => switchMode("signin")}>Back to sign in</button>}
        </div>
      </div>
    </div>
  );
}

function SetupMissing() {
  return (
    <div style={card}>
      <h2 style={h2Style}>Sign-in isn't set up yet</h2>
      <p style={{ fontSize: 13, color: "#777", lineHeight: 1.7, margin: 0 }}>
        The site can't find its Supabase settings. In Vercel, add the environment variables VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then redeploy.
      </p>
    </div>
  );
}

// ─── Downloads ─────────────────────────────────────────────────────────────
function downloadCsv(role, occupation, mappedTasks) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Role", "Occupation", "O*NET-SOC code", "#", "Task", "Task type", "AI Resilience automation likelihood", "AI Resilience group", "AI impact", "Importance", "Action"];
  const rows = mappedTasks.map((t, i) => [
    role, occupation?.title || "", occupation?.code || "", i + 1, t.task, t.airesilience?.taskType || "",
    t.airesilience ? pct(t.airesilience.automationLikelihood) : "",
    t.airesilience ? airesGroup(t.airesilience.automationLikelihood).label : "",
    impactLabel(t.impact), importanceLabel(t.importance), ACTION_META[t.action].label,
  ]);
  const credit = [["Task automation data: AI Resilience Report by CareerVillage.org, licensed under CC BY 4.0. https://www.airesilience.org"],
                  ["Occupation and task information derived from the O*NET database by USDOL/ETA, provided through AI Resilience. O*NET is a trademark of USDOL/ETA."]];
  const csv = "\uFEFF" + [header, ...rows, [], ...credit].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `AI-Transformation-Profile-${(role || "role").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ─── Main app (after sign-in) ──────────────────────────────────────────────
function ProfileTool({ session }) {
  const [view, setView] = useState("home"); // "home" | "saved" | "builder"
  const [step, setStep] = useState(1);
  const [role, setRole] = useState("");
  const [tasks, setTasks] = useState([{ id: 1, task: "", impact: "", importance: "" }]);
  const [loading, setLoading] = useState(false);
  const [aiText, setAiText] = useState("");
  const [occMatches, setOccMatches] = useState([]);     // occupations returned by search
  const [occIndex, setOccIndex] = useState(0);          // which match we're showing
  const [occConfirmPending, setOccConfirmPending] = useState(false);
  const [occChosen, setOccChosen] = useState(null);     // { code, title } once accepted
  const [importanceDefinition, setImportanceDefinition] = useState("");
  const [impactHelpData, setImpactHelpData] = useState({});
  const [aires, setAires] = useState(null);              // AI Resilience data for the chosen occupation
  const [airesNote, setAiresNote] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);

  const [savedList, setSavedList] = useState([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState("");
  const [currentProfileId, setCurrentProfileId] = useState(null);
  const [saveStatus, setSaveStatus] = useState(""); // "", "saving", "saved", or an error message

  const addTask    = () => setTasks((t) => [...t, { id: Date.now(), task: "", impact: "", importance: "" }]);
  const removeTask = (id) => setTasks((t) => t.filter((x) => x.id !== id));
  const updateTask = (id, f, v) => { setTasks((t) => t.map((x) => x.id === id ? { ...x, [f]: v } : x)); setSaveStatus(""); };
  const filledTasks = tasks.filter((t) => t.task.trim());

  // ── Saved profiles ──
  const loadSavedList = useCallback(async () => {
    setSavedLoading(true);
    const { data, error } = await supabase.from("saved_profiles").select("id, role, updated_at, occupation:data->occupation").order("updated_at", { ascending: false });
    if (error) setSavedError(`Couldn't load your saved profiles: ${error.message}`);
    else { setSavedError(""); setSavedList(data || []); }
    setSavedLoading(false);
  }, []);

  useEffect(() => { loadSavedList(); }, [loadSavedList]);

  const saveProfile = async () => {
    setSaveStatus("saving");
    const payload = { role, data: { role, tasks: filledTasks, importanceDefinition, occupation: occChosen, aires: aires ? { code: aires.code, name: aires.name, url: aires.url, label: aires.label, score: aires.score } : null }, updated_at: new Date().toISOString() };
    const query = currentProfileId
      ? supabase.from("saved_profiles").update(payload).eq("id", currentProfileId).select("id").single()
      : supabase.from("saved_profiles").insert(payload).select("id").single();
    const { data, error } = await query;
    if (error) { setSaveStatus(`Couldn't save: ${error.message}`); return; }
    setCurrentProfileId(data.id);
    setSaveStatus("saved");
    loadSavedList();
  };

  const openProfile = async (id) => {
    const { data, error } = await supabase.from("saved_profiles").select("id, data").eq("id", id).single();
    if (error || !data) { setSavedError("Couldn't open that profile. Try again."); return; }
    const d = data.data || {};
    setRole(d.role || "");
    setTasks((d.tasks && d.tasks.length) ? d.tasks : [{ id: 1, task: "", impact: "", importance: "" }]);
    setImportanceDefinition(d.importanceDefinition || "");
    setOccChosen(d.occupation || d.onet || null);
    setAires(d.aires || null); setAiresNote("");
    setOccMatches([]); setOccIndex(0); setOccConfirmPending(false); setAiText(""); setImpactHelpData({});
    setCurrentProfileId(data.id);
    setSaveStatus("saved");
    setStep(5);
    setView("builder");
  };

  const deleteProfile = async (id, name) => {
    if (!window.confirm(`Delete the saved profile for "${name}"? This can't be undone.`)) return;
    const { error } = await supabase.from("saved_profiles").delete().eq("id", id);
    if (error) { setSavedError(`Couldn't delete: ${error.message}`); return; }
    if (id === currentProfileId) { setCurrentProfileId(null); setSaveStatus(""); }
    loadSavedList();
  };

  // ── Occupation search and tasks (AI Resilience) ──
  const suggestTasks = useCallback(async () => {
    setLoading(true); setAiText(""); setAiresNote(""); setOccConfirmPending(false);
    try {
      const occupations = await searchOccupations(role);
      if (!occupations.length) {
        setOccMatches([]);
        setAiText(`No occupations found matching "${role}". Try a shorter or more common job title on step 1 (for example, "nurse" instead of "charge nurse"), or enter tasks yourself.`);
      } else {
        setOccMatches(occupations); setOccIndex(0); setOccConfirmPending(true);
        setAiText(`Occupations matching "${role}":`);
      }
    } catch (err) {
      setAiText(`Couldn't search occupations (${err.message}). Enter tasks yourself, or try again.`);
    }
    setLoading(false);
  }, [role]);

  const currentMatch = occMatches[occIndex];

  const acceptTasks = async () => {
    if (!currentMatch) return;
    setLoading(true);
    try {
      const data = await fetchAiResilience(currentMatch.code);
      if (!data?.tasks?.length) throw new Error("no tasks are listed for this occupation");
      const chosen = selectTasks(data.tasks, MAX_TASKS).map((t, i) => ({
        id: Date.now() + i, onetTaskId: t.id, task: t.task, impact: "", importance: "",
        airesilience: typeof t.automationLikelihood === "number" ? { automationLikelihood: t.automationLikelihood, taskType: t.taskType || null } : null,
      }));
      const coreCount = chosen.filter((t) => t.airesilience?.taskType === "Core").length;
      setTasks(chosen);
      setAires(data);
      setOccChosen({ code: currentMatch.code, title: currentMatch.title });
      setOccConfirmPending(false);
      setImpactHelpData({});
      setAiText(`Loaded ${chosen.length} of ${data.tasks.length} O*NET tasks for ${currentMatch.title} (${coreCount} core, ${chosen.length - coreCount} supplemental). Edit, add, or remove as needed.`);
    } catch (err) {
      setAiText(`Couldn't load tasks (${err.message}). Try another match, or enter tasks yourself.`);
    }
    setLoading(false);
  };

  const rejectOccupation = () => {
    if (occIndex + 1 < occMatches.length) {
      setOccIndex(occIndex + 1);
    } else {
      setOccConfirmPending(false);
      setAiText("That was the last match. Try a different job title on step 1, or enter tasks yourself.");
    }
  };

  // ── AI impact help ──
  const getImpactHelp = useCallback(async (taskId, taskText, airesTask) => {
    setImpactHelpData((d) => ({ ...d, [taskId]: { loading: true, result: null } }));
    const group = airesTask ? airesGroup(airesTask.automationLikelihood) : null;
    const allowed = group ? group.allowed : IMPACT_TYPES.map((t) => t.key);
    const dataNote = group
      ? `\nAI Resilience (airesilience.org) data estimates this task's automation likelihood at ${pct(airesTask.automationLikelihood)}, placing it in the "${group.label}" group. You MUST choose between ${allowed.join(" and ")} only. In the rationale, mention the AI Resilience estimate and explain why you chose ${allowed.join(" or ")}.`
      : "";
    try {
      const result = await callClaude(
        [{ role: "user", content: `Classify this task for role "${role}": "${taskText}"` }],
        `You are an expert in the JFF AI-Ready Workforce Framework and the Anthropic Economic Index.
Respond ONLY with valid JSON, no other text:
{"impact":"${allowed.join("|")}","confidence":"high|medium|low","rationale":"1-2 sentence explanation"}
Definitions: replace=routine physical, AI automates; displace=routine cognitive, AI takes over; complement=machine collab, neutral; augment=complex cognitive, AI boosts humans; elevate=interpersonal/human, AI raises importance${dataNote}`
      );
      const parsed = JSON.parse(result.replace(/```json|```/g, "").trim());
      if (!allowed.includes(parsed.impact)) { parsed.impact = null; parsed.rationale = `${parsed.rationale || ""} (Suggestion didn't fit the AI Resilience group. Please select manually.)`.trim(); }
      setImpactHelpData((d) => ({ ...d, [taskId]: { loading: false, result: parsed } }));
    } catch { setImpactHelpData((d) => ({ ...d, [taskId]: { loading: false, result: { impact: null, rationale: "Could not classify. Please select manually." } } })); }
  }, [role]);

  // Runs "Help me classify" for every task that doesn't have an impact yet, one at a time.
  const suggestAll = async () => {
    setBulkRunning(true);
    for (const t of filledTasks.filter((x) => !x.impact)) {
      await getImpactHelp(t.id, t.task, t.airesilience);
    }
    setBulkRunning(false);
  };

  const applyImpactSuggestion = (id, impact) => { updateTask(id, "impact", impact); setImpactHelpData((d) => ({ ...d, [id]: null })); };

  const mappedTasks = filledTasks.filter((t) => t.impact && t.importance).map((t) => ({ ...t, action: getAction(t.impact, t.importance) }));
  const actionGroups = { future_proof: [], capitalize: [], automate: [], reimagine: [] };
  mappedTasks.forEach((t) => actionGroups[t.action].push(t));

  const ok1 = role.trim().length > 0;
  const ok2 = filledTasks.length > 0;
  const ok3 = ok2 && filledTasks.every((t) => t.impact);
  const ok4 = ok2 && filledTasks.every((t) => t.impact && t.importance);

  const resetAll = () => {
    setStep(1); setRole(""); setTasks([{ id: 1, task: "", impact: "", importance: "" }]); setAiText("");
    setOccMatches([]); setOccIndex(0); setOccConfirmPending(false); setOccChosen(null);
    setImportanceDefinition(""); setImpactHelpData({}); setCurrentProfileId(null); setSaveStatus("");
    setAires(null); setAiresNote("");
  };

  const STEPS = ["Role", "Tasks", "AI Impact", "Importance", "Results"];

  // Work in progress that hasn't been saved since the last change
  const inProgress = Boolean(role.trim() || filledTasks.length);
  const hasUnsaved = inProgress && saveStatus !== "saved";

  const startNew = () => {
    if (hasUnsaved && !window.confirm(`Start a new profile? Your unsaved work on "${role || "your current profile"}" will be lost.`)) return;
    resetAll();
    setView("builder");
  };
  const goHome = () => { setView("home"); loadSavedList(); };
  const goSaved = () => { setView("saved"); loadSavedList(); };

  const navLink = (active) => ({ ...linkBtn, textDecoration: "none", color: active ? "#231F20" : "#1A9999", fontWeight: active ? 700 : 500, cursor: active ? "default" : "pointer" });
  const Nav = () => (
    <div className="no-print" style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: "1.5rem", fontSize: 13 }}>
      <button style={navLink(view === "home")} onClick={goHome}>Home</button>
      <button style={navLink(view === "saved")} onClick={goSaved}>Saved profiles{!savedLoading && savedList.length > 0 && ` (${savedList.length})`}</button>
      <button style={navLink(false)} onClick={startNew}>New profile</button>
    </div>
  );

  const SavedList = () => (
    savedLoading
      ? <p style={{ fontSize: 13, color: "#999", margin: 0 }}>Loading...</p>
      : savedList.length === 0
        ? <div>
            <p style={{ fontSize: 13, color: "#777", margin: "0 0 12px", lineHeight: 1.6 }}>You haven't saved any profiles yet. Finish a profile, then select "Save to my account" on the results page.</p>
            <button onClick={startNew} style={btnPrimary(true)}>Start a new profile</button>
          </div>
        : savedList.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: i < savedList.length - 1 ? "1px solid #f2f2f0" : "none", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#231F20" }}>{p.role}</div>
              <div style={{ fontSize: 11, color: "#999", lineHeight: 1.6 }}>
                {p.occupation?.title && <>{p.occupation.title} · </>}Last saved {new Date(p.updated_at).toLocaleString()}
              </div>
            </div>
            <button onClick={() => openProfile(p.id)} style={{ ...btnSecondary, fontSize: 12, padding: "5px 12px", color: "#1A9999", borderColor: "#2BBFBF" }}>Open</button>
            <button onClick={() => deleteProfile(p.id, p.role)} style={{ ...btnSecondary, fontSize: 12, padding: "5px 12px", color: "#999" }}>Delete</button>
          </div>
        ))
  );

  const errorBox = savedError && (
    <div role="alert" style={{ background: "#FDF0EE", color: "#C0392B", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: "1rem", lineHeight: 1.6 }}>{savedError}</div>
  );

  // ── Home ──
  if (view === "home") {
    const homeCard = { ...card, marginBottom: 0, display: "flex", flexDirection: "column", gap: 10 };
    return (
      <>
        <h2 style={{ ...h2Style, fontSize: 26, marginBottom: 4 }}>What would you like to do?</h2>
        <p style={{ fontSize: 13, color: "#777", margin: "0 0 1.5rem", lineHeight: 1.7 }}>Build a new AI Transformation Profile for a role, or return to one you've saved.</p>
        {errorBox}
        {inProgress && (
          <div style={{ background: "#F7F9CC", borderRadius: 10, padding: "12px 16px", marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#555", flex: 1 }}>
              You have a profile in progress for <strong>{role || "an untitled role"}</strong>{hasUnsaved ? " with unsaved changes." : "."}
            </span>
            <button onClick={() => setView("builder")} style={{ ...btnSecondary, fontSize: 12, padding: "6px 14px", background: "#fff" }}>Continue</button>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          <div style={{ ...homeCard, borderTop: "4px solid #E8442A" }}>
            <h3 style={{ fontFamily: "var(--font-title)", fontSize: 20, fontWeight: 500, margin: 0, color: "#231F20" }}>Create a new profile</h3>
            <p style={{ fontSize: 13, color: "#777", margin: 0, lineHeight: 1.7, flex: 1 }}>Pick a role, load its O*NET tasks, classify how AI affects each one, and get an action plan.</p>
            <div><button onClick={startNew} style={btnPrimary(true)}>Start a new profile</button></div>
          </div>
          <div style={{ ...homeCard, borderTop: "4px solid #2BBFBF" }}>
            <h3 style={{ fontFamily: "var(--font-title)", fontSize: 20, fontWeight: 500, margin: 0, color: "#231F20" }}>View saved profiles</h3>
            <p style={{ fontSize: 13, color: "#777", margin: 0, lineHeight: 1.7, flex: 1 }}>
              {savedLoading ? "Checking your account..." : savedList.length === 0 ? "You haven't saved any profiles yet." : `You have ${savedList.length} saved profile${savedList.length === 1 ? "" : "s"}. Open one to review, update, or download it.`}
            </p>
            <div><button onClick={goSaved} style={btnSecondary}>View saved profiles</button></div>
          </div>
        </div>
      </>
    );
  }

  // ── Saved profiles ──
  if (view === "saved") {
    return (
      <>
        <Nav />
        <h2 style={{ ...h2Style, marginBottom: "1rem" }}>Your saved profiles</h2>
        {errorBox}
        <div style={card}><SavedList /></div>
      </>
    );
  }

  return (
    <>
      <Nav />
      {/* Stepper */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", marginBottom: "2rem" }}>
        {STEPS.map((label, i) => {
          const n = i + 1, active = step === n, done = step > n;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "none" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div onClick={() => done && setStep(n)} style={{ width: 30, height: 30, borderRadius: "50%", background: done ? "#E8442A" : active ? "#FDF0EE" : "#eee", border: `2px solid ${done || active ? "#E8442A" : "#ddd"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: done ? "#fff" : active ? "#E8442A" : "#bbb", cursor: done ? "pointer" : "default", flexShrink: 0 }}>
                  {done ? "✓" : n}
                </div>
                <span style={{ fontSize: 10, color: active ? "#E8442A" : "#aaa", fontWeight: active ? 700 : 400, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
              </div>
              {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: done ? "#E8442A" : "#ddd", margin: "0 4px", marginBottom: 20, borderRadius: 1 }} />}
            </div>
          );
        })}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div>
          <div style={card}>
            <h2 style={{ ...h2Style, marginBottom: 8 }}>What role would you like to analyze?</h2>
            <p style={{ fontSize: 13, color: "#777", margin: "0 0 1.25rem", lineHeight: 1.7 }}>Enter a specific job title or occupation. This is used to find the matching O*NET occupation and its tasks, and to apply the AI-Ready Workforce Framework.</p>
            <input type="text" placeholder="e.g. Registered Nurse, Software Developer, Retail Salesperson..." value={role} onChange={(e) => { setRole(e.target.value); setOccMatches([]); setOccConfirmPending(false); setSaveStatus(""); }} onKeyDown={(e) => e.key === "Enter" && ok1 && setStep(2)} />
          </div>
          <button onClick={() => setStep(2)} disabled={!ok1} style={btnPrimary(ok1)}>Continue →</button>

        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ ...h2Style, marginBottom: 4 }}>Key tasks for: <em style={{ color: "#E8442A" }}>{role}</em></h2>
                <p style={{ fontSize: 13, color: "#777", margin: 0, lineHeight: 1.7 }}>Add the core tasks and responsibilities this role performs day-to-day.</p>
              </div>
              <button onClick={suggestTasks} disabled={loading} style={{ ...btnSecondary, fontSize: 12, padding: "6px 14px", whiteSpace: "nowrap", flexShrink: 0, marginLeft: 16, color: "#1A9999", borderColor: "#2BBFBF" }}>
                {loading ? "Searching..." : "Suggest O*NET tasks ↗"}
              </button>
            </div>
            {aiText && <div style={{ background: "#F7F9CC", borderRadius: 8, padding: "10px 14px", marginBottom: "1rem", fontSize: 13, color: "#666" }}>{aiText}{airesNote && <><br />{airesNote}</>}</div>}
            {occConfirmPending && currentMatch && (
              <div style={{ background: "#E8F8F8", border: "1px solid #2BBFBF", borderRadius: 8, padding: "14px", marginBottom: "1rem" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#1A9999", margin: "0 0 4px" }}>Occupation match: {currentMatch.title} ({currentMatch.code})</p>
                <p style={{ fontSize: 12, color: "#1A9999", margin: "0 0 12px" }}>Match {occIndex + 1} of {occMatches.length}. Is this the right occupation? Loading its tasks will replace the task list below.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={acceptTasks} disabled={loading} style={{ ...btnPrimary(!loading), fontSize: 12, padding: "6px 14px", background: "#2BBFBF" }}>{loading ? "Loading tasks..." : "Yes, load these tasks"}</button>
                  <button onClick={rejectOccupation} disabled={loading} style={{ ...btnSecondary, fontSize: 12, padding: "6px 14px" }}>No, try another</button>
                </div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tasks.map((t, i) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "#ccc", minWidth: 20, textAlign: "right" }}>{i + 1}</span>
                  <input type="text" placeholder={`Task ${i + 1}...`} value={t.task} onChange={(e) => updateTask(t.id, "task", e.target.value)} style={{ flex: 1 }} />
                  {tasks.length > 1 && <button onClick={() => removeTask(t.id)} aria-label={`Remove task ${i + 1}`} style={{ fontSize: 18, padding: "2px 8px", color: "#ccc", background: "none", border: "none", cursor: "pointer" }}>×</button>}
                </div>
              ))}
            </div>
            <button onClick={addTask} style={{ ...btnSecondary, marginTop: 12, fontSize: 12, padding: "6px 14px", borderStyle: "dashed" }}>+ Add task</button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(1)} style={btnSecondary}>← Back</button>
            <button onClick={() => setStep(3)} disabled={!ok2} style={btnPrimary(ok2)}>Continue → ({filledTasks.length} task{filledTasks.length !== 1 ? "s" : ""})</button>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div>
          <div style={card}>
            <h2 style={h2Style}>Classify the AI impact for each task</h2>
            <p style={{ fontSize: 13, color: "#777", margin: "0 0 1rem", lineHeight: 1.7 }}>Select how AI is likely to affect each task. Where AI Resilience data is available, it narrows each task to two options: tasks likely to be automated point to Replace or Displace, and the rest point to Augment or Elevate. "Help me classify" then suggests which of the two fits best.</p>
            <div style={{ background: aires ? "#E8F8F8" : "#F8F8F6", border: `1px solid ${aires ? "#2BBFBF" : "#eee"}`, borderRadius: 8, padding: "10px 14px", marginBottom: "1rem", fontSize: 13, color: aires ? "#1A9999" : "#777", lineHeight: 1.6 }}>
              {aires
                ? <>AI Resilience data for <a href={aires.url} target="_blank" rel="noreferrer" style={{ color: "#1A9999", fontWeight: 600 }}>{aires.name}</a>{aires.label && <> (rated {aires.label}{aires.score != null && `, ${pct(aires.score)}`})</>}. Scores found for {filledTasks.filter((t) => t.airesilience).length} of {filledTasks.length} tasks.</>
                : <>AI Resilience scores load automatically when you pick an occupation with "Suggest O*NET tasks" on step 2. Tasks you typed yourself are classified without them.</>}
            </div>
            <div style={{ marginBottom: "1.25rem" }}>
              <button onClick={suggestAll} disabled={bulkRunning || filledTasks.every((t) => t.impact)} style={{ ...btnSecondary, fontSize: 12, padding: "6px 14px", color: "#1A9999", borderColor: "#2BBFBF" }}>
                {bulkRunning ? "Suggesting..." : "Suggest for all unclassified tasks ↗"}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.25rem", padding: "12px 14px", background: "#F8F8F6", borderRadius: 8, border: "1px solid #eee" }}>
              {IMPACT_TYPES.map((t) => (
                <div key={t.key} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 12, color: "#666", lineHeight: 1.5 }}>
                  <span style={{ minWidth: 92, flexShrink: 0 }}><Badge impact={t.key} /></span>
                  <span>{t.desc}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {filledTasks.map((t, i) => {
                const help = impactHelpData[t.id];
                return (
                  <div key={t.id} style={{ borderBottom: i < filledTasks.length - 1 ? "1px solid #f2f2f0" : "none", paddingBottom: 16 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "#ccc", minWidth: 20, textAlign: "right", paddingTop: 3 }}>{i + 1}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#231F20" }}>{t.task}</p>
                        {t.airesilience && (() => {
                          const g = airesGroup(t.airesilience.automationLikelihood);
                          return <p style={{ margin: "0 0 10px", fontSize: 12, color: "#666" }}>AI Resilience: {pct(t.airesilience.automationLikelihood)} automation likelihood, so <strong style={{ color: g.key === "automate" ? "#C0392B" : "#8A9600" }}>{g.text}</strong></p>;
                        })()}
                        {!t.airesilience && <div style={{ height: 4 }} />}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {IMPACT_TYPES.map((imp) => (
                            <button key={imp.key} onClick={() => updateTask(t.id, "impact", imp.key)} style={{ fontSize: 12, padding: "5px 13px", background: t.impact === imp.key ? imp.bg : "transparent", color: t.impact === imp.key ? imp.color : "#888", border: `1px solid ${t.impact === imp.key ? imp.color : "#ddd"}`, borderRadius: 8, cursor: "pointer", fontWeight: t.impact === imp.key ? 700 : 400 }}>{imp.label}</button>
                          ))}
                          <button onClick={() => getImpactHelp(t.id, t.task, t.airesilience)} disabled={help?.loading} style={{ fontSize: 11, padding: "5px 13px", color: "#1A9999", border: "1px solid #2BBFBF", background: "transparent", borderRadius: 8, cursor: "pointer" }}>
                            {help?.loading ? "Analyzing..." : "Help me classify ↗"}
                          </button>
                        </div>
                        {help && !help.loading && help.result && (
                          <div style={{ marginTop: 10, background: "#E8F8F8", borderRadius: 8, padding: "10px 14px" }}>
                            <p style={{ margin: "0 0 8px", color: "#1A9999", fontSize: 12, lineHeight: 1.6 }}>{help.result.rationale}</p>
                            {help.result.impact && (
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 12, color: "#666" }}>Suggested:</span>
                                <Badge impact={help.result.impact} />
                                <button onClick={() => applyImpactSuggestion(t.id, help.result.impact)} style={{ fontSize: 11, padding: "4px 12px", background: "#E8442A", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>Apply</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(2)} style={btnSecondary}>← Back</button>
            <button onClick={() => setStep(4)} disabled={!ok3} style={btnPrimary(ok3)}>Continue →</button>
          </div>
        </div>
      )}

      {/* Step 4 */}
      {step === 4 && (
        <div>
          <div style={card}>
            <h2 style={h2Style}>Rate the importance of each task</h2>
            <p style={{ fontSize: 13, color: "#777", margin: "0 0 1rem", lineHeight: 1.7 }}>How important is each task to the overall role? Consider: Is it on performance reviews? Do others depend on it? Is it customer-facing or compliance-critical?</p>
            <div style={{ background: "#F8F8F6", borderRadius: 8, padding: "12px 14px", marginBottom: "1.25rem", border: "1px solid #eee" }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#999", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Your importance definition (optional)</label>
              <input type="text" placeholder="e.g. A task is important if it appears on performance reviews or directly impacts patient outcomes..." value={importanceDefinition} onChange={(e) => setImportanceDefinition(e.target.value)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {filledTasks.map((t, i) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: i < filledTasks.length - 1 ? "1px solid #f2f2f0" : "none", paddingBottom: 12 }}>
                  <span style={{ fontSize: 12, color: "#ccc", minWidth: 20, textAlign: "right" }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#231F20" }}>{t.task}</span>
                      <Badge impact={t.impact} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {IMPORTANCE_LEVELS.map((lv) => {
                        const map = IMPORTANCE_COLORS;
                        const { c, bg } = map[lv.key]; const sel = t.importance === lv.key;
                        return <button key={lv.key} onClick={() => updateTask(t.id, "importance", lv.key)} style={{ fontSize: 12, padding: "5px 13px", background: sel ? bg : "transparent", color: sel ? c : "#888", border: `1px solid ${sel ? c : "#ddd"}`, borderRadius: 8, cursor: "pointer", fontWeight: sel ? 700 : 400 }}>{lv.label}</button>;
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(3)} style={btnSecondary}>← Back</button>
            <button onClick={() => setStep(5)} disabled={!ok4} style={btnPrimary(ok4)}>View results →</button>
          </div>
        </div>
      )}

      {/* Step 5 */}
      {step === 5 && (
        <div>
          {/* Save and download bar */}
          <div className="no-print" style={{ ...card, padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button onClick={saveProfile} disabled={saveStatus === "saving"} style={btnPrimary(saveStatus !== "saving")}>
              {saveStatus === "saving" ? "Saving..." : currentProfileId ? "Save changes" : "Save to my account"}
            </button>
            <button onClick={() => downloadCsv(role, occChosen, mappedTasks)} style={btnSecondary}>Download spreadsheet (CSV)</button>
            <button onClick={() => window.print()} style={btnSecondary}>Print or save as PDF</button>
            {saveStatus === "saved" && <span style={{ fontSize: 12, color: "#1A9999" }}>Saved. Find it anytime under Saved profiles.</span>}
            {saveStatus && saveStatus !== "saved" && saveStatus !== "saving" && <span style={{ fontSize: 12, color: "#C0392B" }}>{saveStatus}</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: "1.25rem" }}>
            {Object.entries(actionGroups).map(([key, t]) => {
              const m = ACTION_META[key];
              return (
                <div key={key} style={{ background: m.bg, borderRadius: 10, padding: "14px 12px", textAlign: "center", border: `1px solid ${m.border}50` }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: m.color, fontFamily: "var(--font-title)" }}>{t.length}</div>
                  <div style={{ fontSize: 10, color: m.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{m.label}</div>
                </div>
              );
            })}
          </div>

          <div style={{ background: "#231F20", borderRadius: 10, padding: "12px 18px", marginBottom: "1.25rem" }}>
            <span style={{ fontSize: 13, color: "#ccc" }}>
              <strong style={{ color: "#fff", fontFamily: "var(--font-title)", fontSize: 15 }}>AI Transformation Profile:</strong> {role} — {mappedTasks.length} tasks analyzed
              {occChosen && <> · Occupation: {occChosen.title} ({occChosen.code})</>}
              {aires?.label && <> · AI Resilience: <a href={aires.url} target="_blank" rel="noreferrer" style={{ color: "#2BBFBF" }}>{aires.label}</a></>}
            </span>
            {importanceDefinition.trim() && <p style={{ fontSize: 12, color: "#aaa", margin: "6px 0 0", lineHeight: 1.6 }}>Importance defined as: {importanceDefinition}</p>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "1.5rem" }}>
            {QUADRANTS.map(({ key, label, accent }) => (
              <div key={key} className="print-avoid-break">
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 3, height: 14, background: accent, borderRadius: 2 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
                </div>
                <ActionCard actionKey={key} tasks={actionGroups[key]} />
              </div>
            ))}
          </div>

          <div style={card}>
            <h3 style={{ fontFamily: "var(--font-title)", fontSize: 20, fontWeight: 500, margin: "0 0 1rem", color: "#231F20" }}>All tasks summary</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #f0f0ee" }}>
                    {["#", "Task", "Automation likelihood", "AI impact", "Importance", "Action"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "#999", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedTasks.map((t, i) => {
                    const m = ACTION_META[t.action];
                    return (
                      <tr key={t.id} style={{ borderBottom: "1px solid #f7f7f5" }}>
                        <td style={{ padding: "9px 10px", color: "#ccc" }}>{i + 1}</td>
                        <td style={{ padding: "9px 10px", color: "#231F20", fontWeight: 500 }}>{t.task}</td>
                        <td style={{ padding: "9px 10px", color: "#666" }}>{t.airesilience ? pct(t.airesilience.automationLikelihood) : "—"}</td>
                        <td style={{ padding: "9px 10px" }}><Badge impact={t.impact} /></td>
                        <td style={{ padding: "9px 10px" }}><ImportanceBadge importance={t.importance} /></td>
                        <td style={{ padding: "9px 10px" }}><span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: m.bg, color: m.color, border: `1px solid ${m.border}60`, textTransform: "uppercase", letterSpacing: "0.06em" }}>{m.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="print-avoid-break" style={{ background: "#231F20", borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h3 style={{ fontFamily: "var(--font-title)", fontSize: 20, fontWeight: 500, color: "#fff", margin: "0 0 1rem" }}>Strategic reflection prompts</h3>
            {[
              { q: "What has this exercise shown you about the current and future impact of AI on this role?", c: "#E8442A" },
              { q: "Is there a specific quadrant you want to focus on first?",                                 c: "#2BBFBF" },
              { q: "What steps are you currently taking to prepare workers for AI integration?",               c: "#C8D400" },
              { q: "What internal or external support do you need to better prepare for AI transformation?",  c: "#888"    },
            ].map(({ q, c }, i) => (
              <p key={i} style={{ fontSize: 13, color: "#bbb", margin: "0 0 12px", paddingLeft: 14, borderLeft: `3px solid ${c}`, lineHeight: 1.7 }}>{q}</p>
            ))}
          </div>

          <div className="no-print" style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(4)} style={btnSecondary}>← Back</button>
            <button onClick={goHome} style={btnSecondary}>Start a New Profile or See Saved Profiles</button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── App root: decides whether to show sign-in or the tool ─────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) { setChecking(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); setSession(null); };

  if (!supabaseConfigured) return <Shell><SetupMissing /></Shell>;
  if (checking) return <Shell><p style={{ fontSize: 13, color: "#999" }}>Loading...</p></Shell>;
  if (!session || recovery) return <Shell><AuthScreen recovery={recovery} onRecoveryDone={() => setRecovery(false)} /></Shell>;

  return (
    <Shell email={session.user?.email} onSignOut={signOut}>
      <ProfileTool key={session.user?.id} session={session} />
    </Shell>
  );
}
