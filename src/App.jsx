import { useState, useCallback } from "react";

const fontStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=DM+Sans:wght@400;500;600&display=swap');
  :root {
    --font-title: 'Playfair Display', Georgia, serif;
    --font-body:  'DM Sans', system-ui, sans-serif;
    --jff-red:    #E8442A;
    --jff-cyan:   #2BBFBF;
    --jff-yellow: #C8D400;
    --jff-black:  #231F20;
  }
  *, body { font-family: var(--font-body); box-sizing: border-box; }
  input { font-family: var(--font-body); font-size: 14px; padding: 9px 13px; border: 1px solid #ddd; border-radius: 8px; outline: none; width: 100%; }
  input:focus { border-color: var(--jff-cyan); }
`;

const API_URL = import.meta.env.VITE_API_URL || "/api/claude";

async function callClaude(messages, systemPrompt) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: systemPrompt, messages }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${response.status}`);
  }
  const data = await response.json();
  return data.content?.map((b) => b.text || "").join("") || "";
}

const IMPACT_TYPES = [
  { key: "replace",    label: "Replace",    color: "#C0392B", bg: "#FDF0EE", desc: "Routine physical tasks fully automated by AI, significantly decreasing human use" },
  { key: "displace",   label: "Displace",   color: "#E8442A", bg: "#FEF3F1", desc: "Routine cognitive tasks increasingly performed by AI, decreasing human use" },
  { key: "complement", label: "Complement", color: "#1A9999", bg: "#E8F8F8", desc: "Machine collaboration tasks where AI works alongside humans with neutral impact" },
  { key: "augment",    label: "Augment",    color: "#8A9600", bg: "#F7F9CC", desc: "Complex cognitive tasks where AI increases human performance" },
  { key: "elevate",    label: "Elevate",    color: "#2BBFBF", bg: "#D4F2F2", desc: "Interpersonal/human tasks whose importance is significantly increased by AI" },
];

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

// JFF Logo as inline SVG — no image file needed
function JFFLogo() {
  return (
    <svg height="38" viewBox="0 0 300 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Red column */}
      <rect x="2" y="8" width="18" height="62" fill="#E8442A"/>
      {/* Dark circle bottom-left, overlapping red */}
      <circle cx="2" cy="65" r="13" fill="#231F20"/>

      {/* Cyan column */}
      <rect x="26" y="4" width="18" height="66" fill="#2BBFBF"/>
      {/* Dark circle mid, overlapping cyan */}
      <circle cx="26" cy="48" r="14" fill="#231F20"/>

      {/* Yellow-green column */}
      <rect x="50" y="0" width="18" height="70" fill="#C8D400"/>
      {/* Dark circle upper, overlapping yellow */}
      <circle cx="63" cy="22" r="12" fill="#231F20"/>

      {/* Wordmark */}
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
  const map = { very_important: { bg: "#FDF0EE", c: "#C0392B" }, important: { bg: "#E8F8F8", c: "#1A9999" }, somewhat_important: { bg: "#F7F9CC", c: "#8A9600" }, not_important: { bg: "#F5F5F5", c: "#666" } };
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

export default function App() {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState("");
  const [tasks, setTasks] = useState([{ id: 1, task: "", impact: "", importance: "" }]);
  const [loading, setLoading] = useState(false);
  const [aiText, setAiText] = useState("");
  const [onetOccupation, setOnetOccupation] = useState(null);
  const [onetConfirmPending, setOnetConfirmPending] = useState(false);
  const [onetSearchIndex, setOnetSearchIndex] = useState(0);
  const [importanceDefinition, setImportanceDefinition] = useState("");
  const [impactHelpData, setImpactHelpData] = useState({});

  const addTask    = () => setTasks((t) => [...t, { id: Date.now(), task: "", impact: "", importance: "" }]);
  const removeTask = (id) => setTasks((t) => t.filter((x) => x.id !== id));
  const updateTask = (id, f, v) => setTasks((t) => t.map((x) => x.id === id ? { ...x, [f]: v } : x));
  const filledTasks = tasks.filter((t) => t.task.trim());

  const suggestFromOnet = useCallback(async () => {
    setLoading(true); setAiText("");
    try {
      const result = await callClaude(
        [{ role: "user", content: `Find the closest O*NET occupation for: "${role}". Attempt #${onetSearchIndex + 1}. ${onetSearchIndex > 0 ? "Suggest a different occupation than before." : ""}` }],
        `You are an expert in O*NET occupational data. Respond ONLY with valid JSON, no other text:
{"occupation_name":"...","onet_code":"...","typical_tasks":["task 1","task 2","task 3","task 4","task 5","task 6","task 7","task 8"]}
Return 8 specific, action-oriented typical tasks from O*NET for that occupation.`
      );
      const parsed = JSON.parse(result.replace(/```json|```/g, "").trim());
      setOnetOccupation(parsed); setOnetConfirmPending(true);
      setAiText(`Found closest O*NET match for "${role}":`);
    } catch { setAiText("Could not search O*NET. Please enter tasks manually."); }
    setLoading(false);
  }, [role, onetSearchIndex]);

  const acceptOnetTasks = () => {
    setTasks(onetOccupation.typical_tasks.map((t, i) => ({ id: Date.now() + i, task: t, impact: "", importance: "" })));
    setOnetConfirmPending(false); setAiText("Tasks loaded from O*NET. Edit, add, or remove as needed.");
  };
  const rejectOnetOccupation = () => { setOnetSearchIndex((i) => i + 1); setOnetConfirmPending(false); setOnetOccupation(null); suggestFromOnet(); };

  const getImpactHelp = useCallback(async (taskId, taskText) => {
    setImpactHelpData((d) => ({ ...d, [taskId]: { loading: true, result: null } }));
    try {
      const result = await callClaude(
        [{ role: "user", content: `Classify this task for role "${role}": "${taskText}"` }],
        `You are an expert in the JFF AI-Ready Workforce Framework and the Anthropic Economic Index.
Respond ONLY with valid JSON, no other text:
{"impact":"replace|displace|complement|augment|elevate","confidence":"high|medium|low","rationale":"1-2 sentence explanation"}
Definitions: replace=routine physical, AI automates; displace=routine cognitive, AI takes over; complement=machine collab, neutral; augment=complex cognitive, AI boosts humans; elevate=interpersonal/human, AI raises importance`
      );
      const parsed = JSON.parse(result.replace(/```json|```/g, "").trim());
      setImpactHelpData((d) => ({ ...d, [taskId]: { loading: false, result: parsed } }));
    } catch { setImpactHelpData((d) => ({ ...d, [taskId]: { loading: false, result: { impact: null, rationale: "Could not classify. Please select manually." } } })); }
  }, [role]);

  const applyImpactSuggestion = (id, impact) => { updateTask(id, "impact", impact); setImpactHelpData((d) => ({ ...d, [id]: null })); };

  const mappedTasks = filledTasks.filter((t) => t.impact && t.importance).map((t) => ({ ...t, action: getAction(t.impact, t.importance) }));
  const actionGroups = { future_proof: [], capitalize: [], automate: [], reimagine: [] };
  mappedTasks.forEach((t) => actionGroups[t.action].push(t));

  const ok1 = role.trim().length > 0;
  const ok2 = filledTasks.length > 0;
  const ok3 = ok2 && filledTasks.every((t) => t.impact);
  const ok4 = ok2 && filledTasks.every((t) => t.impact && t.importance);

  const resetAll = () => { setStep(1); setRole(""); setTasks([{ id: 1, task: "", impact: "", importance: "" }]); setAiText(""); setOnetOccupation(null); setOnetConfirmPending(false); setOnetSearchIndex(0); setImpactHelpData({}); };

  const STEPS = ["Role", "Tasks", "AI Impact", "Importance", "Results"];

  return (
    <>
      <style>{fontStyle}</style>
      <div style={{ minHeight: "100vh", background: "#F8F8F6" }}>

        {/* Nav */}
        <div style={{ background: "#fff", borderBottom: "1px solid #EAEAE6", padding: "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <JFFLogo />
          <span style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em" }}>AI-Ready Workforce Framework</span>
        </div>

        {/* Hero */}
        <div style={{ background: "#231F20", padding: "28px 32px 22px" }}>
          <h1 style={{ fontFamily: "var(--font-title)", fontSize: 28, fontWeight: 500, color: "#fff", margin: "0 0 6px", letterSpacing: "-0.01em" }}>AI Transformation Profile</h1>
          <p style={{ fontSize: 13, color: "#aaa", margin: "0 0 16px", lineHeight: 1.7, maxWidth: 520 }}>Apply the JFF AI-Ready Workforce Framework to map any role's tasks against AI impact — and build a clear action plan.</p>
          <div style={{ display: "flex", gap: 5 }}>
            {["#E8442A", "#2BBFBF", "#C8D400", "#555"].map((c) => <div key={c} style={{ height: 4, width: 28, borderRadius: 2, background: c }} />)}
          </div>
        </div>

        <div style={{ maxWidth: 780, margin: "0 auto", padding: "2rem 1.5rem" }}>

          {/* Stepper */}
          <div style={{ display: "flex", alignItems: "center", marginBottom: "2rem" }}>
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
              <div style={{ background: "#fff", border: "1px solid #EAEAE6", borderRadius: 12, padding: "1.5rem", marginBottom: "1.25rem" }}>
                <h2 style={{ fontFamily: "var(--font-title)", fontSize: 22, fontWeight: 500, margin: "0 0 8px", color: "#231F20" }}>What role would you like to analyze?</h2>
                <p style={{ fontSize: 13, color: "#777", margin: "0 0 1.25rem", lineHeight: 1.7 }}>Enter a specific job title or occupation. This will be used to pull O*NET tasks and apply the AI-Ready Workforce Framework.</p>
                <input type="text" placeholder="e.g. Registered Nurse, Software Developer, Retail Salesperson..." value={role} onChange={(e) => setRole(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok1 && setStep(2)} />
              </div>
              <button onClick={() => setStep(2)} disabled={!ok1} style={btnPrimary(ok1)}>Continue →</button>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div>
              <div style={{ background: "#fff", border: "1px solid #EAEAE6", borderRadius: 12, padding: "1.5rem", marginBottom: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
                  <div>
                    <h2 style={{ fontFamily: "var(--font-title)", fontSize: 22, fontWeight: 500, margin: "0 0 4px", color: "#231F20" }}>Key tasks for: <em style={{ color: "#E8442A" }}>{role}</em></h2>
                    <p style={{ fontSize: 13, color: "#777", margin: 0, lineHeight: 1.7 }}>Add the core tasks and responsibilities this role performs day-to-day.</p>
                  </div>
                  <button onClick={suggestFromOnet} disabled={loading} style={{ ...btnSecondary, fontSize: 12, padding: "6px 14px", whiteSpace: "nowrap", flexShrink: 0, marginLeft: 16, color: "#1A9999", borderColor: "#2BBFBF" }}>
                    {loading ? "Searching..." : "Suggest from O*NET ↗"}
                  </button>
                </div>
                {aiText && <div style={{ background: "#F7F9CC", borderRadius: 8, padding: "10px 14px", marginBottom: "1rem", fontSize: 13, color: "#666" }}>{aiText}</div>}
                {onetConfirmPending && onetOccupation && (
                  <div style={{ background: "#E8F8F8", border: "1px solid #2BBFBF", borderRadius: 8, padding: "14px", marginBottom: "1rem" }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#1A9999", margin: "0 0 4px" }}>O*NET match: {onetOccupation.occupation_name} ({onetOccupation.onet_code})</p>
                    <p style={{ fontSize: 12, color: "#1A9999", margin: "0 0 12px" }}>{onetOccupation.typical_tasks.length} tasks found. Is this the right occupation?</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={acceptOnetTasks} style={{ ...btnPrimary(true), fontSize: 12, padding: "6px 14px", background: "#2BBFBF" }}>Yes, load these tasks</button>
                      <button onClick={rejectOnetOccupation} style={{ ...btnSecondary, fontSize: 12, padding: "6px 14px" }}>No, try another</button>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {tasks.map((t, i) => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "#ccc", minWidth: 20, textAlign: "right" }}>{i + 1}</span>
                      <input type="text" placeholder={`Task ${i + 1}...`} value={t.task} onChange={(e) => updateTask(t.id, "task", e.target.value)} style={{ flex: 1 }} />
                      {tasks.length > 1 && <button onClick={() => removeTask(t.id)} style={{ fontSize: 18, padding: "2px 8px", color: "#ccc", background: "none", border: "none", cursor: "pointer" }}>×</button>}
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
              <div style={{ background: "#fff", border: "1px solid #EAEAE6", borderRadius: 12, padding: "1.5rem", marginBottom: "1.25rem" }}>
                <h2 style={{ fontFamily: "var(--font-title)", fontSize: 22, fontWeight: 500, margin: "0 0 6px", color: "#231F20" }}>Classify the AI impact for each task</h2>
                <p style={{ fontSize: 13, color: "#777", margin: "0 0 1.25rem", lineHeight: 1.7 }}>Select how AI is likely to affect each task. Use "Help me classify" for AI-powered guidance drawing on the Anthropic Economic Index.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: "1.25rem", padding: "12px 14px", background: "#F8F8F6", borderRadius: 8, border: "1px solid #eee" }}>
                  {IMPACT_TYPES.map((t) => (
                    <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#777" }}>
                      <Badge impact={t.key} /><span>{t.desc.substring(0, 44)}…</span>
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
                            <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600, color: "#231F20" }}>{t.task}</p>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {IMPACT_TYPES.map((imp) => (
                                <button key={imp.key} onClick={() => updateTask(t.id, "impact", imp.key)} style={{ fontSize: 12, padding: "5px 13px", background: t.impact === imp.key ? imp.bg : "transparent", color: t.impact === imp.key ? imp.color : "#888", border: `1px solid ${t.impact === imp.key ? imp.color : "#ddd"}`, borderRadius: 8, cursor: "pointer", fontWeight: t.impact === imp.key ? 700 : 400 }}>{imp.label}</button>
                              ))}
                              <button onClick={() => getImpactHelp(t.id, t.task)} disabled={help?.loading} style={{ fontSize: 11, padding: "5px 13px", color: "#1A9999", border: "1px solid #2BBFBF", background: "transparent", borderRadius: 8, cursor: "pointer" }}>
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
              <div style={{ background: "#fff", border: "1px solid #EAEAE6", borderRadius: 12, padding: "1.5rem", marginBottom: "1.25rem" }}>
                <h2 style={{ fontFamily: "var(--font-title)", fontSize: 22, fontWeight: 500, margin: "0 0 6px", color: "#231F20" }}>Rate the importance of each task</h2>
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
                            const map = { very_important: { c: "#C0392B", bg: "#FDF0EE" }, important: { c: "#1A9999", bg: "#E8F8F8" }, somewhat_important: { c: "#8A9600", bg: "#F7F9CC" }, not_important: { c: "#555", bg: "#F5F5F5" } };
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
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "1.5rem" }}>
                {[
                  { key: "future_proof", label: "High importance + Replace / Displace",           accent: "#E8442A" },
                  { key: "capitalize",   label: "High importance + Augment / Elevate",             accent: "#2BBFBF" },
                  { key: "automate",     label: "Low importance + Replace / Displace / Complement",accent: "#C8D400" },
                  { key: "reimagine",    label: "Low importance + Augment / Elevate",              accent: "#888"    },
                ].map(({ key, label, accent }) => (
                  <div key={key}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <div style={{ width: 3, height: 14, background: accent, borderRadius: 2 }} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
                    </div>
                    <ActionCard actionKey={key} tasks={actionGroups[key]} />
                  </div>
                ))}
              </div>

              <div style={{ background: "#fff", border: "1px solid #EAEAE6", borderRadius: 12, padding: "1.5rem", marginBottom: "1.25rem" }}>
                <h3 style={{ fontFamily: "var(--font-title)", fontSize: 20, fontWeight: 500, margin: "0 0 1rem", color: "#231F20" }}>All tasks summary</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #f0f0ee" }}>
                        {["#", "Task", "AI impact", "Importance", "Action"].map((h) => (
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

              <div style={{ background: "#231F20", borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem" }}>
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

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setStep(4)} style={btnSecondary}>← Back</button>
                <button onClick={resetAll} style={btnSecondary}>Start over</button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid #EAEAE6", padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff" }}>
          <span style={{ fontSize: 11, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.05em" }}>Powered by the JFF AI-Ready Workforce Framework</span>
          <div style={{ display: "flex", gap: 5 }}>
            {["#E8442A", "#2BBFBF", "#C8D400"].map((c) => <div key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />)}
          </div>
        </div>
      </div>
    </>
  );
}
