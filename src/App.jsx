import { useState, useEffect } from "react";

const SHEET_FILE_NAME = "Dashboard_Gestao_Tarefas";

async function callDriveAI(userMessage, conversationHistory = []) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: `Você é um assistente que gerencia dados de projetos e tarefas usando Google Drive MCP. O arquivo de dados se chama "${SHEET_FILE_NAME}.json" no Google Drive. Sempre responda APENAS com JSON válido, sem markdown, sem texto extra.`,
      messages: [...conversationHistory, { role: "user", content: userMessage }],
      mcp_servers: [{ type: "url", url: "https://drivemcp.googleapis.com/mcp/v1", name: "gdrive" }],
    }),
  });
  const data = await response.json();
  return data;
}

const STATUS_CONFIG = {
  "Não iniciado": { color: "#94a3b8", bg: "#f1f5f9", icon: "○" },
  "Em andamento": { color: "#3b82f6", bg: "#eff6ff", icon: "◔" },
  "Bloqueado":    { color: "#ef4444", bg: "#fef2f2", icon: "✕" },
  "Concluído":    { color: "#22c55e", bg: "#f0fdf4", icon: "✓" },
};
const PRIORITY_CONFIG = {
  Alta:  { color: "#ef4444", label: "↑ Alta" },
  Média: { color: "#f59e0b", label: "→ Média" },
  Baixa: { color: "#22c55e", label: "↓ Baixa" },
};

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date(new Date().toISOString().split("T")[0])) / 86400000);
}

function DeadlineBadge({ date }) {
  if (!date) return <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>;
  const d = daysUntil(date);
  const color = d < 0 ? "#ef4444" : d <= 3 ? "#f59e0b" : "#64748b";
  const label = d < 0 ? `${Math.abs(d)}d atrasado` : d === 0 ? "Hoje" : `${d}d`;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, background: color + "18", padding: "2px 7px", borderRadius: 20 }}>
      {new Date(date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · {label}
    </span>
  );
}

const EMPTY_ITEM = { id: "", title: "", type: "task", projectId: "", status: "Não iniciado", priority: "Média", deadline: "", responsible: "", notes: "" };

export default function Dashboard() {
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [driveFileId, setDriveFileId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [filterStatus, setFilterStatus] = useState("Todos");
  const [filterPriority, setFilterPriority] = useState("Todas");
  const [filterProject, setFilterProject] = useState("Todos");
  const [view, setView] = useState("board");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_ITEM);
  const [driveHistory, setDriveHistory] = useState([]);
  const [tab, setTab] = useState("tasks");

  useEffect(() => { loadFromDrive(); }, []);

  async function loadFromDrive() {
    setSyncing(true); setSyncMsg("Conectando ao Google Drive…");
    try {
      const history = [];
      const res1 = await callDriveAI(`Procure um arquivo chamado "${SHEET_FILE_NAME}.json" no Google Drive. Responda APENAS com JSON: {"found": true/false, "fileId": "...", "content": {...}}`, history);
      history.push({ role: "user", content: `Procure um arquivo chamado "${SHEET_FILE_NAME}.json" no Google Drive. Responda APENAS com JSON: {"found": true/false, "fileId": "...", "content": {...}}` });
      const textBlocks = res1.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "{}";
      history.push({ role: "assistant", content: res1.content });
      setDriveHistory(history);
      let parsed = {};
      try { parsed = JSON.parse(textBlocks.replace(/```json|```/g, "").trim()); } catch {}
      if (parsed.found && parsed.content) {
        setDriveFileId(parsed.fileId || null);
        setItems(parsed.content.items || []);
        setProjects(parsed.content.projects || []);
        setSyncMsg("✓ Dados carregados do Drive");
      } else {
        const seed = getSeedData();
        setItems(seed.items); setProjects(seed.projects);
        setSyncMsg("✓ Novo arquivo criado no Drive");
        await saveToDrive(seed.items, seed.projects, history);
      }
    } catch { setSyncMsg("Drive não conectado — offline"); const seed = getSeedData(); setItems(seed.items); setProjects(seed.projects); }
    setSyncing(false);
  }

  async function saveToDrive(currentItems, currentProjects, history = driveHistory) {
    setSyncing(true); setSyncMsg("Salvando no Drive…");
    const payload = JSON.stringify({ items: currentItems, projects: currentProjects });
    try {
      const prompt = driveFileId
        ? `Atualize o arquivo com ID "${driveFileId}" com este conteúdo: ${payload}. Responda com JSON: {"success": true}`
        : `Crie um arquivo "${SHEET_FILE_NAME}.json" com este conteúdo: ${payload}. Responda com JSON: {"success": true, "fileId": "..."}`;
      const res = await callDriveAI(prompt, history);
      const textBlocks = res.content?.filter(b => b.type === "text").map(b => b.text).join("") || "{}";
      let parsed = {};
      try { parsed = JSON.parse(textBlocks.replace(/```json|```/g, "").trim()); } catch {}
      if (parsed.fileId) setDriveFileId(parsed.fileId);
      setSyncMsg("✓ Salvo · " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    } catch { setSyncMsg("⚠ Salvo localmente"); }
    setSyncing(false);
  }

  function openNew(type = "task") { setForm({ ...EMPTY_ITEM, id: crypto.randomUUID(), type }); setModal({ mode: "new" }); }
  function openEdit(item) { setForm({ ...item }); setModal({ mode: "edit" }); }

  function saveForm() {
    if (form.type === "project") {
      const np = modal.mode === "new" ? [...projects, form] : projects.map(p => p.id === form.id ? form : p);
      setProjects(np); saveToDrive(items, np);
    } else {
      const ni = modal.mode === "new" ? [...items, form] : items.map(i => i.id === form.id ? form : i);
      setItems(ni); saveToDrive(ni, projects);
    }
    setModal(null);
  }

  function deleteItem(id, type) {
    if (type === "project") {
      const np = projects.filter(p => p.id !== id);
      const ni = items.filter(i => i.projectId !== id);
      setProjects(np); setItems(ni); saveToDrive(ni, np);
    } else {
      const ni = items.filter(i => i.id !== id);
      setItems(ni); saveToDrive(ni, projects);
    }
  }

  function cycleStatus(id, type) {
    const statuses = Object.keys(STATUS_CONFIG);
    if (type === "project") {
      const np = projects.map(p => p.id === id ? { ...p, status: statuses[(statuses.indexOf(p.status) + 1) % statuses.length] } : p);
      setProjects(np); saveToDrive(items, np);
    } else {
      const ni = items.map(i => i.id === id ? { ...i, status: statuses[(statuses.indexOf(i.status) + 1) % statuses.length] } : i);
      setItems(ni); saveToDrive(ni, projects);
    }
  }

  const filteredItems = items.filter(i => {
    if (filterStatus !== "Todos" && i.status !== filterStatus) return false;
    if (filterPriority !== "Todas" && i.priority !== filterPriority) return false;
    if (filterProject !== "Todos" && i.projectId !== filterProject) return false;
    return true;
  });

  const done = items.filter(i => i.status === "Concluído").length;
  const overdue = items.filter(i => i.deadline && daysUntil(i.deadline) < 0 && i.status !== "Concluído").length;
  const urgent = items.filter(i => i.deadline && daysUntil(i.deadline) >= 0 && daysUntil(i.deadline) <= 3 && i.status !== "Concluído").length;

  const s = {
    wrap: { fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: "#f8fafc", minHeight: "100vh", paddingBottom: 60 },
    header: { background: "#0f172a", color: "#f1f5f9", padding: "20px 28px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" },
    statsRow: { display: "flex", gap: 12, padding: "16px 28px", flexWrap: "wrap" },
    statCard: (a) => ({ flex: "1 1 100px", background: "#fff", border: `2px solid ${a}22`, borderRadius: 12, padding: "14px 18px" }),
    statNum: (a) => ({ fontSize: 28, fontWeight: 800, color: a, lineHeight: 1 }),
    statLabel: { fontSize: 11, color: "#94a3b8", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 },
    toolbar: { display: "flex", gap: 8, padding: "0 28px 12px", flexWrap: "wrap", alignItems: "center" },
    select: { fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer" },
    btn: (v = "primary") => ({ fontSize: 12, fontWeight: 600, padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", background: v === "primary" ? "#3b82f6" : v === "ghost" ? "transparent" : "#f1f5f9", color: v === "primary" ? "#fff" : "#334155" }),
    tabBtn: (a) => ({ fontSize: 13, fontWeight: a ? 700 : 500, padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", background: a ? "#0f172a" : "transparent", color: a ? "#fff" : "#64748b" }),
    board: { display: "flex", gap: 16, padding: "0 28px", overflowX: "auto" },
    col: { minWidth: 240, flex: "1 1 240px", background: "#fff", borderRadius: 14, padding: 14, boxShadow: "0 1px 4px #0001" },
    card: { background: "#f8fafc", borderRadius: 10, padding: "11px 12px", marginBottom: 8, cursor: "pointer", border: "1px solid #e2e8f0" },
    list: { padding: "0 28px" },
    listRow: { background: "#fff", borderRadius: 10, padding: "11px 16px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10, border: "1px solid #e2e8f0", cursor: "pointer" },
    overlay: { position: "fixed", inset: 0, background: "#0007", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" },
    modal: { background: "#fff", borderRadius: 16, padding: 28, width: "min(96vw, 480px)", maxHeight: "90vh", overflowY: "auto" },
    label: { fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 },
    input: { width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" },
    textarea: { width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", resize: "vertical", minHeight: 72, boxSizing: "border-box" },
  };

  const boardCols = Object.entries(STATUS_CONFIG).map(([status, cfg]) => ({ status, cfg, items: filteredItems.filter(i => i.status === status) }));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>📋 Dashboard de Gestão</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Projetos · Tarefas · Prazos</div>
        </div>
        <span style={{ fontSize: 11, color: syncing ? "#fbbf24" : "#86efac", background: "#1e293b", padding: "4px 10px", borderRadius: 20 }}>
          {syncing ? "⟳ Sincronizando…" : syncMsg || "Google Drive"}
        </span>
      </div>

      <div style={s.statsRow}>
        {[["#3b82f6", items.length, "Total"], ["#22c55e", done, "Concluídas"], ["#f59e0b", urgent, "Urgentes"], ["#ef4444", overdue, "Atrasadas"], ["#8b5cf6", projects.length, "Projetos"]].map(([a, n, l]) => (
          <div key={l} style={s.statCard(a)}><div style={s.statNum(a)}>{n}</div><div style={s.statLabel}>{l}</div></div>
        ))}
      </div>

      <div style={s.toolbar}>
        <button style={s.tabBtn(tab === "tasks")} onClick={() => setTab("tasks")}>Tarefas</button>
        <button style={s.tabBtn(tab === "projects")} onClick={() => setTab("projects")}>Projetos</button>
        <div style={{ flex: 1 }} />
        {tab === "tasks" && <>
          <select style={s.select} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option>Todos</option>{Object.keys(STATUS_CONFIG).map(s => <option key={s}>{s}</option>)}
          </select>
          <select style={s.select} value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
            <option>Todas</option>{Object.keys(PRIORITY_CONFIG).map(p => <option key={p}>{p}</option>)}
          </select>
          <button style={s.btn("secondary")} onClick={() => setView(v => v === "board" ? "list" : "board")}>{view === "board" ? "☰ Lista" : "⊞ Board"}</button>
        </>}
        <button style={s.btn()} onClick={() => openNew(tab === "projects" ? "project" : "task")}>+ {tab === "projects" ? "Projeto" : "Tarefa"}</button>
      </div>

      {tab === "projects" ? (
        <div style={s.list}>
          {projects.map(p => {
            const pTasks = items.filter(i => i.projectId === p.id);
            const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG["Não iniciado"];
            return (
              <div key={p.id} style={{ ...s.listRow, borderLeft: `4px solid ${cfg.color}` }} onClick={() => { setForm({ ...p, type: "project" }); setModal({ mode: "edit" }); }}>
                <span style={{ fontSize: 18 }}>{cfg.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{p.title}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{pTasks.length} tarefas · {pTasks.filter(i => i.status === "Concluído").length}/{pTasks.length} concluídas{p.responsible && ` · ${p.responsible}`}</div>
                </div>
                <DeadlineBadge date={p.deadline} />
                <button style={{ ...s.btn("ghost"), color: "#ef4444", padding: "4px 8px" }} onClick={e => { e.stopPropagation(); if (confirm("Excluir projeto?")) deleteItem(p.id, "project"); }}>✕</button>
              </div>
            );
          })}
        </div>
      ) : view === "board" ? (
        <div style={s.board}>
          {boardCols.map(({ status, cfg, items: colItems }) => (
            <div key={status} style={s.col}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color, textTransform: "uppercase", marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
                <span>{cfg.icon} {status}</span>
                <span style={{ background: cfg.bg, padding: "1px 7px", borderRadius: 10 }}>{colItems.length}</span>
              </div>
              {colItems.map(item => {
                const proj = projects.find(p => p.id === item.projectId);
                const pc = PRIORITY_CONFIG[item.priority];
                return (
                  <div key={item.id} style={s.card} onClick={() => openEdit(item)}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>{item.title}</div>
                    {proj && <div style={{ fontSize: 10, color: "#8b5cf6", marginBottom: 4 }}>📁 {proj.title}</div>}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {pc && <span style={{ fontSize: 10, color: pc.color, fontWeight: 700 }}>{pc.label}</span>}
                      <DeadlineBadge date={item.deadline} />
                    </div>
                    {item.responsible && <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>👤 {item.responsible}</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div style={s.list}>
          {filteredItems.map(item => {
            const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG["Não iniciado"];
            const pc = PRIORITY_CONFIG[item.priority];
            const proj = projects.find(p => p.id === item.projectId);
            return (
              <div key={item.id} style={{ ...s.listRow, borderLeft: `4px solid ${cfg.color}` }} onClick={() => openEdit(item)}>
                <button style={{ ...s.btn("ghost"), fontSize: 16, color: cfg.color, padding: "2px 6px" }} onClick={e => { e.stopPropagation(); cycleStatus(item.id, "task"); }}>{cfg.icon}</button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, textDecoration: item.status === "Concluído" ? "line-through" : "none", color: item.status === "Concluído" ? "#94a3b8" : "#0f172a" }}>{item.title}</div>
                  {proj && <span style={{ fontSize: 10, color: "#8b5cf6" }}>📁 {proj.title}</span>}
                </div>
                {pc && <span style={{ fontSize: 11, color: pc.color, fontWeight: 700 }}>{pc.label}</span>}
                <DeadlineBadge date={item.deadline} />
                <button style={{ ...s.btn("ghost"), color: "#ef4444", padding: "4px 8px" }} onClick={e => { e.stopPropagation(); if (confirm("Excluir?")) deleteItem(item.id, "task"); }}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <div style={s.overlay} onClick={() => setModal(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 18 }}>{modal.mode === "new" ? (form.type === "project" ? "Novo Projeto" : "Nova Tarefa") : "Editar"}</div>
            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>Tipo</label>
              <select style={s.input} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="task">Tarefa</option><option value="project">Projeto</option>
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>Título *</label>
              <input style={s.input} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Descreva…" />
            </div>
            {form.type === "task" && (
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Projeto (opcional)</label>
                <select style={s.input} value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}>
                  <option value="">— Nenhum —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div><label style={s.label}>Status</label>
                <select style={s.input} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {Object.keys(STATUS_CONFIG).map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label style={s.label}>Prioridade</label>
                <select style={s.input} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                  {Object.keys(PRIORITY_CONFIG).map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div><label style={s.label}>Prazo</label>
                <input type="date" style={s.input} value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
              </div>
              <div><label style={s.label}>Responsável</label>
                <input style={s.input} value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible: e.target.value }))} placeholder="Nome…" />
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={s.label}>Notas</label>
              <textarea style={s.textarea} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Observações…" />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={s.btn("secondary")} onClick={() => setModal(null)}>Cancelar</button>
              <button style={s.btn()} onClick={saveForm} disabled={!form.title.trim()}>
                {modal.mode === "new" ? "Criar" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getSeedData() {
  const proj1 = crypto.randomUUID();
  const proj2 = crypto.randomUUID();
  return {
    projects: [
      { id: proj1, title: "Planejamento Aliança 2026", status: "Em andamento", deadline: "2026-06-30", responsible: "Bianca", notes: "" },
      { id: proj2, title: "Fórum Itinerante", status: "Não iniciado", deadline: "2026-07-15", responsible: "Parceiros Aliança", notes: "" },
    ],
    items: [
      { id: crypto.randomUUID(), title: "Consolidar resultados ICA 2025", type: "task", projectId: proj1, status: "Em andamento", priority: "Alta", deadline: "2026-06-05", responsible: "Bianca", notes: "" },
      { id: crypto.randomUUID(), title: "Revisar dados de equidade racial", type: "task", projectId: proj1, status: "Não iniciado", priority: "Alta", deadline: "2026-06-10", responsible: "Bianca", notes: "" },
      { id: crypto.randomUUID(), title: "Preparar pauta do Fórum", type: "task", projectId: proj2, status: "Não iniciado", priority: "Média", deadline: "2026-07-01", responsible: "Equipe Aliança", notes: "" },
      { id: crypto.randomUUID(), title: "Enviar relatório para Instituto Natura", type: "task", projectId: "", status: "Não iniciado", priority: "Alta", deadline: "2026-05-28", responsible: "Bianca", notes: "" },
    ],
  };
}
