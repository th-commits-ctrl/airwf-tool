import { useState, useCallback } from "react";

// ─── API helper ────────────────────────────────────────────────────────────────
// Calls your serverless proxy instead of Anthropic directly.
// Set VITE_API_URL in your .env file:
//   Vercel:  VITE_API_URL=/api/claude
//   Netlify: VITE_API_URL=/.netlify/functions/claude
const API_URL = import.meta.env.VITE_API_URL || "/api/claude";

async function callClaude(messages, systemPrompt) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.content?.map((b) => b.text || "").join("") || "";
}

// ─── Framework constants ───────────────────────────────────────────────────────
const IMPACT_TYPES = [
  { key: "replace",    label: "Replace",    color: "#E24B4A", bg: "#FCEBEB", desc: "Routine physical tasks fully automated by AI, significantly decreasing human use" },
  { key: "displace",   label: "Displace",   color: "#BA7517", bg: "#FAEEDA", desc: "Routine cognitive tasks increasingly performed by AI, decreasing human use" },
  { key: "complement", label: "Complement", color: "#378ADD", bg: "#E6F1FB", desc: "Machine collaboration tasks where AI works alongside humans with neutral impact" },
  { key: "augment",    label: "Augment",    color: "#3B6D11", bg: "#EAF3DE", desc: "Complex cognitive tasks where AI increases human performance" },
  { key: "elevate",    label: "Elevate",    color: "#533AB7", bg: "#EEEDFE", desc: "Interpersonal/human tasks whose importance is significantly increased by AI" },
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
  future_proof: { label: "Future-Proof", color: "#E24B4A", bg: "#FCEBEB", desc: "Tasks at risk of displacement that are critical to this role. Act now to upskill workers or redefine responsibilities before AI takes over." },
  capitalize:   { label: "Capitalize",   color: "#533AB7", bg: "#EEEDFE", desc: "Human and analytical strengths that AI will amplify. Double down — invest in developing these skills and find AI use cases that build on them." },
  automate:     { label: "Automate",     color: "#378ADD", bg: "#E6F1FB", desc: "Tasks that aren't central to the role and can be handled by machines. Prioritize these for AI or automation solutions to free up human capacity." },
  reimagine:    { label: "Reimagine",    color: "#3B6D11", bg: "#EAF3DE", desc: "Human skills underutilized in this role today. Redesign the job to bring these capabilities forward as AI handles lower-value work." },
};

// ─── Sub-components ────────────────────────────────────────────────────────────
function Badge({ impact }) {
  const meta = IMPACT_TYPES.find((t) => t.key === impact);
  if (!meta) return null;
  return (
    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4, background: meta.bg, color: meta.color, border: `0.5px solid ${meta.color}40`, whiteSpace: "nowrap" }}>
      {meta.label}
    </span>
  );
}

function ImportanceBadge({ importance }) {
  const meta = IMPORTANCE_LEVELS.find((l) => l.key === importance);
  if (!meta) return null;
  const colors = { very_important: { bg: "#EEEDFE", color: "#533AB7" }, important: { bg: "#E1F5EE", color: "#0F6E56" }, somewhat_important: { bg: "#FAEEDA", color: "#854F0B" }, not_important: { bg: "#F1EFE8", color: "#5F5E5A" } };
  const c = colors[importance];
  return (
    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4, background: c.bg, color: c.color, border: `0.5px solid ${c.color}40`, whiteSpace: "nowrap" }}>
      {meta.label}
    </span>
  );
}

function ActionCard({ actionKey, tasks }) {
  const meta = ACTION_META[actionKey];
  return (
    <div style={{ background: "var(--color-background-primary)", border: `1.5px solid ${meta.color}`, borderRadius: "var(--border-radius-lg)", padding: "1rem", minHeight: 140 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4, background: meta.bg, color: meta.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{meta.label}</span>
      </div>
      <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 10px", lineHeight: 1.5 }}>{meta.desc}</p>
      {tasks.length === 0
        ? <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>No tasks mapped here</p>
        : tasks.map((t, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: i < tasks.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
            <span style={{ fontSize: 13, color: "var(--color-text-primary)", flex: 1 }}>{t.task}</span>
            <Badge impact={t.impact} />
          </div>
        ))
      }
    </div>
  );
}

// ─── Main app ──────────────────────────────────────────────────────────────────
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
  const updateTask = (id, field, val) => setTasks((t) => t.map((x) => (x.id === id ? { ...x, [field]: val } : x)));

  const filledTasks = tasks.filter((t) => t.task.trim());

  // ── O*NET suggestion ─────────────────────────────────────────────────────────
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
      setOnetOccupation(parsed);
      setOnetConfirmPending(true);
      setAiText(`Found closest O*NET match for "${role}":`);
    } catch {
      setAiText("Could not search O*NET. Please enter tasks manually.");
    }
    setLoading(false);
  }, [role, onetSearchIndex]);

  const acceptOnetTasks = () => {
    setTasks(onetOccupation.typical_tasks.map((t, i) => ({ id: Date.now() + i, task: t, impact: "", importance: "" })));
    setOnetConfirmPending(false);
    setAiText("Tasks loaded from O*NET. Edit, add, or remove as needed.");
  };

  const rejectOnetOccupation = () => {
    setOnetSearchIndex((i) => i + 1);
    setOnetConfirmPending(false);
    setOnetOccupation(null);
    suggestFromOnet();
  };

  // ── Impact help ───────────────────────────────────────────────────────────────
  const getImpactHelp = useCallback(async (taskId, taskText) => {
    setImpactHelpData((d) => ({ ...d, [taskId]: { loading: true, result: null } }));
    try {
      const result = await callClaude(
        [{ role: "user", content: `Classify this task for role "${role}": "${taskText}"` }],
        `You are an expert in the JFF AI-Ready Workforce Framework and the Anthropic Economic Index.
Respond ONLY with valid JSON, no other text:
{"impact":"replace|displace|complement|augment|elevate","confidence":"high|medium|low","rationale":"1-2 sentence explanation"}
Definitions:
- replace: routine physical tasks; AI fully automates
- displace: routine cognitive tasks; AI takes over (data processing, rule-based decisions)
- complement: machine collaboration; AI works alongside with neutral impact
- augment: complex cognitive/analytical; AI boosts human performance
- elevate: interpersonal/human tasks (relationships, leadership, empathy); AI raises their importance`
      );
      const parsed = JSON.parse(result.replace(/```json|```/g, "").trim());
      setImpactHelpData((d) => ({ ...d, [taskId]: { loading: false, result: parsed } }));
    } catch {
      setImpactHelpData((d) => ({ ...d, [taskId]: { loading: false, result: { impact: null, rationale: "Could not classify. Please select manually." } } }));
    }
  }, [role]);

  const applyImpactSuggestion = (taskId, impact) => {
    updateTask(taskId, "impact", impact);
    setImpactHelpData((d) => ({ ...d, [taskId]: null }));
  };

  // ── Derived state ─────────────────────────────────────────────────────────────
  const mappedTasks = filledTasks.filter((t) => t.impact && t.importance).map((t) => ({ ...t, action: getAction(t.impact, t.importance) }));
  const actionGroups = { future_proof: [], capitalize: [], automate: [], reimagine: [] };
  mappedTasks.forEach((t) => actionGroups[t.action].push(t));

  const canProceedStep1 = role.trim().length > 0;
  const canProceedStep2 = filledTasks.length > 0;
  const canProceedStep3 = filledTasks.length > 0 && filledTasks.every((t) => t.impact);
  const canProceedStep4 = filledTasks.length > 0 && filledTasks.every((t) => t.impact && t.importance);

  const resetAll = () => {
    setStep(1); setRole(""); setTasks([{ id: 1, task: "", impact: "", importance: "" }]);
    setAiText(""); setOnetOccupation(null); setOnetConfirmPending(false);
    setOnetSearchIndex(0); setImpactHelpData({});
  };

  const stepLabels = ["Role", "Tasks", "AI Impact", "Importance", "Results"];

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "1.5rem 1rem" }}>

      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: "var(--border-radius-md)", background: "#EEEDFE", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="#533AB7" strokeWidth="1.5"/>
              <path d="M5 8l2 2 4-4" stroke="#533AB7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)", fontWeight: 500 }}>JFF AI-Ready Workforce Framework</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>AI Transformation Profile</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "4px 0 0", lineHeight: 1.5 }}>
          Map any role's tasks against AI impact and build a transformation action plan.
        </p>
      </div>

      {/* Stepper */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "1.5rem" }}>
        {stepLabels.map((label, i) => {
          const num = i + 1; const active = step === num; const done = step > num;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", flex: i < stepLabels.length - 1 ? 1 : "none" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div onClick={() => done && setStep(num)} style={{ width: 28, height: 28, borderRadius: "50%", background: done ? "#533AB7" : active ? "#EEEDFE" : "var(--color-background-secondary)", border: `1.5px solid ${done || active ? "#533AB7" : "var(--color-border-tertiary)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, color: done ? "white" : active ? "#533AB7" : "var(--color-text-tertiary)", cursor: done ? "pointer" : "default", flexShrink: 0 }}>
                  {done ? "✓" : num}
                </div>
                <span style={{ fontSize: 11, color: active ? "#533AB7" : "var(--color-text-tertiary)", fontWeight: active ? 500 : 400, whiteSpace: "nowrap" }}>{label}</span>
              </div>
              {i < stepLabels.length - 1 && <div style={{ flex: 1, height: 1.5, background: done ? "#533AB7" : "var(--color-border-tertiary)", margin: "0 4px", marginBottom: 18 }} />}
            </div>
          );
        })}
      </div>

      {/* ── Step 1: Role ── */}
      {step === 1 && (
        <div>
          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 6px" }}>What role would you like to analyze?</h2>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 1rem", lineHeight: 1.5 }}>Enter a specific job title or occupation. This is used to pull O*NET tasks and apply the AI-Ready Workforce Framework.</p>
            <input type="text" placeholder="e.g. Registered Nurse, Software Developer, Retail Salesperson..." value={role} onChange={(e) => setRole(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canProceedStep1 && setStep(2)} style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <button onClick={() => setStep(2)} disabled={!canProceedStep1} style={{ background: canProceedStep1 ? "#533AB7" : undefined, color: canProceedStep1 ? "white" : undefined, border: canProceedStep1 ? "none" : undefined, padding: "8px 20px", borderRadius: "var(--border-radius-md)", cursor: canProceedStep1 ? "pointer" : "not-allowed" }}>Continue →</button>
        </div>
      )}

      {/* ── Step 2: Tasks ── */}
      {step === 2 && (
        <div>
          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 4px" }}>List key tasks for: <em style={{ color: "#533AB7" }}>{role}</em></h2>
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.5 }}>Add the core tasks and responsibilities this role performs day-to-day.</p>
              </div>
              <button onClick={suggestFromOnet} disabled={loading} style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap", flexShrink: 0, marginLeft: 12 }}>{loading ? "Searching..." : "Suggest from O*NET ↗"}</button>
            </div>

            {aiText && <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 12px", marginBottom: "1rem", fontSize: 13, color: "var(--color-text-secondary)" }}>{aiText}</div>}

            {onetConfirmPending && onetOccupation && (
              <div style={{ background: "#EEEDFE", border: "0.5px solid #533AB7", borderRadius: "var(--border-radius-md)", padding: "12px", marginBottom: "1rem" }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: "#533AB7", margin: "0 0 4px" }}>O*NET match: {onetOccupation.occupation_name} ({onetOccupation.onet_code})</p>
                <p style={{ fontSize: 12, color: "#533AB7", margin: "0 0 10px" }}>{onetOccupation.typical_tasks.length} tasks found. Is this the right occupation?</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={acceptOnetTasks} style={{ fontSize: 12, padding: "5px 12px", background: "#533AB7", color: "white", border: "none", borderRadius: "var(--border-radius-md)", cursor: "pointer" }}>Yes, load these tasks</button>
                  <button onClick={rejectOnetOccupation} style={{ fontSize: 12, padding: "5px 12px" }}>No, try another</button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tasks.map((t, i) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", minWidth: 20, textAlign: "right" }}>{i + 1}</span>
                  <input type="text" placeholder={`Task ${i + 1}...`} value={t.task} onChange={(e) => updateTask(t.id, "task", e.target.value)} style={{ flex: 1 }} />
                  {tasks.length > 1 && <button onClick={() => removeTask(t.id)} style={{ fontSize: 16, padding: "4px 8px", color: "var(--color-text-tertiary)", lineHeight: 1 }}>×</button>}
                </div>
              ))}
            </div>
            <button onClick={addTask} style={{ marginTop: 10, fontSize: 12, padding: "5px 12px" }}>+ Add task</button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(1)} style={{ padding: "8px 16px" }}>← Back</button>
            <button onClick={() => setStep(3)} disabled={!canProceedStep2} style={{ background: canProceedStep2 ? "#533AB7" : undefined, color: canProceedStep2 ? "white" : undefined, border: canProceedStep2 ? "none" : undefined, padding: "8px 20px", borderRadius: "var(--border-radius-md)", cursor: canProceedStep2 ? "pointer" : "not-allowed" }}>Continue → ({filledTasks.length} task{filledTasks.length !== 1 ? "s" : ""})</button>
          </div>
        </div>
      )}

      {/* ── Step 3: Impact ── */}
      {step === 3 && (
        <div>
          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 4px" }}>Classify the AI impact for each task</h2>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 1rem", lineHeight: 1.5 }}>Select how AI is likely to affect each task. Use "Help me classify" for AI-powered guidance.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "1rem", padding: "10px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)" }}>
              {IMPACT_TYPES.map((t) => (
                <div key={t.key} style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                  <Badge impact={t.key} /> <span style={{ marginLeft: 2 }}>{t.desc.substring(0, 45)}…</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {filledTasks.map((t, i) => {
                const help = impactHelpData[t.id];
                return (
                  <div key={t.id} style={{ borderBottom: i < filledTasks.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none", paddingBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", minWidth: 20, textAlign: "right", paddingTop: 2 }}>{i + 1}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 500 }}>{t.task}</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                          {IMPACT_TYPES.map((imp) => (
                            <button key={imp.key} onClick={() => updateTask(t.id, "impact", imp.key)} style={{ fontSize: 12, padding: "4px 10px", background: t.impact === imp.key ? imp.bg : "transparent", color: t.impact === imp.key ? imp.color : "var(--color-text-secondary)", border: `1px solid ${t.impact === imp.key ? imp.color : "var(--color-border-tertiary)"}`, borderRadius: "var(--border-radius-md)", cursor: "pointer", fontWeight: t.impact === imp.key ? 500 : 400 }}>{imp.label}</button>
                          ))}
                          <button onClick={() => getImpactHelp(t.id, t.task)} disabled={help?.loading} style={{ fontSize: 11, padding: "4px 10px", color: "#533AB7", borderColor: "#533AB7", background: "transparent" }}>{help?.loading ? "Analyzing..." : "Help me classify ↗"}</button>
                        </div>
                        {help && !help.loading && help.result && (
                          <div style={{ marginTop: 8, background: "#EEEDFE", borderRadius: "var(--border-radius-md)", padding: "8px 10px", fontSize: 12 }}>
                            <p style={{ margin: "0 0 6px", color: "#3C3489" }}>{help.result.rationale}</p>
                            {help.result.impact && (
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ color: "#533AB7" }}>Suggested:</span>
                                <Badge impact={help.result.impact} />
                                <button onClick={() => applyImpactSuggestion(t.id, help.result.impact)} style={{ fontSize: 11, padding: "3px 8px", background: "#533AB7", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>Apply</button>
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
            <button onClick={() => setStep(2)} style={{ padding: "8px 16px" }}>← Back</button>
            <button onClick={() => setStep(4)} disabled={!canProceedStep3} style={{ background: canProceedStep3 ? "#533AB7" : undefined, color: canProceedStep3 ? "white" : undefined, border: canProceedStep3 ? "none" : undefined, padding: "8px 20px", borderRadius: "var(--border-radius-md)", cursor: canProceedStep3 ? "pointer" : "not-allowed" }}>Continue →</button>
          </div>
        </div>
      )}

      {/* ── Step 4: Importance ── */}
      {step === 4 && (
        <div>
          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 4px" }}>Rate the importance of each task</h2>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 1rem", lineHeight: 1.5 }}>How important is each task to the overall role? Consider: Is it on performance reviews? Do others depend on it? Is it customer-facing or compliance-critical?</p>
            <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 12px", marginBottom: "1rem" }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Your importance definition (optional)</label>
              <input type="text" placeholder="e.g. A task is important if it's on performance reviews or directly impacts patient outcomes..." value={importanceDefinition} onChange={(e) => setImportanceDefinition(e.target.value)} style={{ width: "100%", boxSizing: "border-box", fontSize: 13 }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filledTasks.map((t, i) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: i < filledTasks.length - 1 ? "0.5px solid var(--color-border-tertiary)" : "none", paddingBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", minWidth: 20, textAlign: "right" }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{t.task}</span>
                      <Badge impact={t.impact} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {IMPORTANCE_LEVELS.map((lv) => {
                        const cs = { very_important: { c: "#533AB7", bg: "#EEEDFE" }, important: { c: "#0F6E56", bg: "#E1F5EE" }, somewhat_important: { c: "#854F0B", bg: "#FAEEDA" }, not_important: { c: "#5F5E5A", bg: "#F1EFE8" } };
                        const { c, bg } = cs[lv.key]; const sel = t.importance === lv.key;
                        return <button key={lv.key} onClick={() => updateTask(t.id, "importance", lv.key)} style={{ fontSize: 12, padding: "4px 10px", background: sel ? bg : "transparent", color: sel ? c : "var(--color-text-secondary)", border: `1px solid ${sel ? c : "var(--color-border-tertiary)"}`, borderRadius: "var(--border-radius-md)", cursor: "pointer", fontWeight: sel ? 500 : 400 }}>{lv.label}</button>;
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(3)} style={{ padding: "8px 16px" }}>← Back</button>
            <button onClick={() => setStep(5)} disabled={!canProceedStep4} style={{ background: canProceedStep4 ? "#533AB7" : undefined, color: canProceedStep4 ? "white" : undefined, border: canProceedStep4 ? "none" : undefined, padding: "8px 20px", borderRadius: "var(--border-radius-md)", cursor: canProceedStep4 ? "pointer" : "not-allowed" }}>View results →</button>
          </div>
        </div>
      )}

      {/* ── Step 5: Results ── */}
      {step === 5 && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: "1rem" }}>
            {Object.entries(actionGroups).map(([key, t]) => {
              const meta = ACTION_META[key];
              return (
                <div key={key} style={{ background: meta.bg, borderRadius: "var(--border-radius-md)", padding: "10px 12px", textAlign: "center", border: `0.5px solid ${meta.color}40` }}>
                  <div style={{ fontSize: 22, fontWeight: 500, color: meta.color }}>{t.length}</div>
                  <div style={{ fontSize: 11, color: meta.color, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{meta.label}</div>
                </div>
              );
            })}
          </div>

          <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 14px", marginBottom: "1rem", fontSize: 13, color: "var(--color-text-secondary)" }}>
            <strong style={{ color: "var(--color-text-primary)" }}>AI Transformation Profile:</strong> {role} — {mappedTasks.length} tasks analyzed
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: "1.5rem" }}>
            {[
              { key: "future_proof", label: "High importance + Replace / Displace", accent: "#E24B4A" },
              { key: "capitalize",   label: "High importance + Augment / Elevate",  accent: "#533AB7" },
              { key: "automate",     label: "Low importance + Replace / Displace / Complement", accent: "#378ADD" },
              { key: "reimagine",    label: "Low importance + Augment / Elevate",   accent: "#3B6D11" },
            ].map(({ key, label, accent }) => (
              <div key={key}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 3, height: 16, background: accent, borderRadius: 2 }} />
                  <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                </div>
                <ActionCard actionKey={key} tasks={actionGroups[key]} />
              </div>
            ))}
          </div>

          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem", marginBottom: "1rem" }}>
            <h3 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 1rem" }}>All tasks summary</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border-tertiary)" }}>
                    {["#", "Task", "AI impact", "Importance", "Action"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: "var(--color-text-secondary)", fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedTasks.map((t, i) => {
                    const am = ACTION_META[t.action];
                    return (
                      <tr key={t.id} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                        <td style={{ padding: "8px", color: "var(--color-text-tertiary)" }}>{i + 1}</td>
                        <td style={{ padding: "8px" }}>{t.task}</td>
                        <td style={{ padding: "8px" }}><Badge impact={t.impact} /></td>
                        <td style={{ padding: "8px" }}><ImportanceBadge importance={t.importance} /></td>
                        <td style={{ padding: "8px" }}><span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4, background: am.bg, color: am.color, border: `0.5px solid ${am.color}40` }}>{am.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ background: "#EEEDFE", border: "0.5px solid #533AB7", borderRadius: "var(--border-radius-lg)", padding: "1.25rem", marginBottom: "1rem" }}>
            <h3 style={{ fontSize: 14, fontWeight: 500, color: "#533AB7", margin: "0 0 10px" }}>Strategic reflection prompts</h3>
            {[
              "What has this exercise shown you about the current and future impact of AI on this role?",
              "Is there a specific quadrant you want to focus on first?",
              "What steps are you currently taking to prepare workers for AI integration?",
              "What internal or external support do you need to better prepare for AI transformation?",
            ].map((q, i) => (
              <p key={i} style={{ fontSize: 13, color: "#3C3489", margin: "0 0 8px", paddingLeft: 12, borderLeft: "2px solid #AFA9EC", lineHeight: 1.5 }}>{q}</p>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(4)} style={{ padding: "8px 16px" }}>← Back</button>
            <button onClick={resetAll} style={{ padding: "8px 16px" }}>Start over</button>
          </div>
        </div>
      )}
    </div>
  );
}
