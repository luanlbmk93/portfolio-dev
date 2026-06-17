import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { analyzeStatement } from "../services/gemini";
import { analyzeStatement as analyzeStatementNoAI } from "../services/statement";
import jsPDF from "jspdf";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from "chart.js";
import * as XLSX from "xlsx";
import {
  enrichCounterpartyFromDescription,
  extractBestCounterpartyFromDescription,
  isGenericCounterpartyLabel
} from "../utils/counterparty";
import { CreditsFooter } from "./CreditsFooter";
import { AppNav } from "./AppNav";
import { apiPath, appBase } from "../lib/paths";

/** Nome exibido: IA + regra “texto após pelo Pix” na mesma linha */
const resolvedCounterparty = (t: Pick<Transaction, "description" | "counterparty">) =>
  enrichCounterpartyFromDescription(t.description || "", t.counterparty || "").trim();

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const CHART_GOLD = "#d4af37";
const CHART_GOLD_DIM = "rgba(212, 175, 55, 0.35)";
const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: "#1a1a1f",
      borderColor: "#2a2a32",
      borderWidth: 1,
      titleColor: "#fafafa",
      bodyColor: "#a1a1aa",
      padding: 12,
      cornerRadius: 8,
    },
  },
  scales: {
    x: {
      grid: { color: "rgba(42, 42, 50, 0.5)" },
      ticks: { color: "#71717a" },
    },
    y: {
      grid: { color: "rgba(42, 42, 50, 0.5)" },
      ticks: { color: "#71717a", callback: (v: string | number) => `R$ ${v}` },
    },
  },
};

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: string; // 'credito' | 'debito'
  isManuallyExcluded: boolean;
  personName?: string;
  relationship?: string;
  /** Nome da contraparte extraído pela IA (PIX/TED), quando existir */
  counterparty?: string;
}

const EXCLUDE_KEYWORDS = [
  // Bets / Apostas
  'resgate',
  'emprestimo',
  'cdb',
  'cofrinho',
  'porquinho',
  'resgate',
  'bet',
  'bet365',
  'sportingbet',
  'pixbet',
  'betano',
  'betfair',
  'blaze',
  'kto',
  'stake',
  'pix bet',
  'casa de aposta',
  'aposta',
  'apostas',
  'cassino',
  'jogo',
  'loteria',
  'gambling',
];

const money = (v:number) =>
  v.toLocaleString("pt-BR",{minimumFractionDigits:2});

const WHATSAPP_SUPPORT_URL = `https://wa.me/5541985380834?text=${encodeURIComponent(
  "Olá! Preciso de ajuda com a aplicação de extratos bancários."
)}`;

const normalize = (s: string) =>
  (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const fileFingerprint = (f: File) => `${f.name}__${f.size}__${f.lastModified}`;

/** Fallback: "EXTRATOS - VICTOR LEANDRO ... (1).pdf" → nome do titular */
const extractOwnerFromFileName = (fileName: string): string => {
  const base = (fileName || "").replace(/\.(pdf|csv|ofx)$/i, "").trim();
  const m = base.match(/(?:extrato|extratos)\s*[-–]\s*(.+?)(?:\s*\(\d+\)\s*$|\s*-\s*\d+\s*$)/i);
  return m?.[1]?.trim() || "";
};

const mergePdfFiles = (existing: File[], incoming: File[]) => {
  const map = new Map<string, File>();
  existing.forEach((f) => map.set(fileFingerprint(f), f));
  incoming.forEach((f) => map.set(fileFingerprint(f), f));
  return Array.from(map.values());
};

const relationshipOptions = [
  "",
  "pai",
  "mãe",
  "cônjuge",
  "irmão(ã)",
  "filho(a)",
  "outro"
];

const formatMonthKey = (monthKey: string) => {
  // monthKey: "MM/YYYY"
  const [mm, yyyy] = monthKey.split("/");
  if (!mm || !yyyy) return monthKey;
  return `${mm.padStart(2, "0")}/${yyyy}`;
};

const parseBRDate = (dateStr: string) => {
  // accepts "DD/MM/YYYY", "YYYY-MM-DD" ou timestamp "YYYY-MM-DD HH:MM:SS"
  const s = (dateStr || "").trim();
  if (!s) return null;
  const isoDay = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDay) {
    const y = Number(isoDay[1]);
    const m = Number(isoDay[2]);
    const d = Number(isoDay[3]);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split("/").map(Number);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
};

const incomeSourceKeyForTransaction = (t: Transaction): string => {
  const user = (t.personName || "").trim();
  if (user && !isGenericCounterpartyLabel(user)) return user;
  // Relatório/PDF: descrição manda (ex. "TRANSFERENCIA PIX REM: WELLISSON FRANCO PINH")
  const fromDesc = extractBestCounterpartyFromDescription(t.description || "").trim();
  if (fromDesc) return fromDesc;
  const enriched = enrichCounterpartyFromDescription(
    t.description || "",
    t.counterparty || ""
  ).trim();
  if (enriched) return enriched;
  return "Origem não identificada — preencha “Pessoa” na linha ou revise a descrição";
};

type YearlyIncomeStats = {
  year: number;
  /** Soma das entradas válidas no ano */
  yearTotal: number;
  /** Meses com pelo menos uma entrada válida */
  monthsWithData: number;
  /** Média = soma dos totais mensais / quantidade de meses com movimento */
  monthAverage: number;
};

type AuditLogEntry = {
  id: number;
  created_at: string;
  actor_email: string;
  actor_role: string | null;
  action: string;
  statement_owner: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
};

type AuditUserSummary = {
  email: string;
  role: string;
  analysesFinished: number;
  filesProcessed: number;
  reportsOpened: number;
  downloads: number;
  geminiCalls: number;
  lastActivity: string;
  owners: Array<{ name: string; count: number }>;
};

const AUDIT_VIEWERS = new Set(
  String(import.meta.env.VITE_AUDIT_VIEWERS || "luanbiagioni@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

const ACTION_LABELS: Record<string, string> = {
  analysis_batch_start: "Iniciou análise de extrato(s)",
  analysis_file_processed: "Arquivo processado",
  analysis_batch_finish: "Análise concluída",
  analysis_batch_error: "Erro na análise",
  report_open: "Abriu relatório analítico",
  report_close: "Fechou relatório analítico",
  report_open_blocked: "Tentou abrir relatório sem dados",
  report_download_pdf: "Baixou PDF do relatório",
  report_download_excel: "Baixou Excel do relatório",
  gemini_proxy_call: "Consumo de token Gemini",
  gemini_proxy_error: "Erro no consumo Gemini"
};

const toText = (value: unknown) => String(value ?? "").trim();

const extractOwnerFromAudit = (log: AuditLogEntry) => {
  const details = (log.details || {}) as Record<string, unknown>;
  return (
    toText(log.statement_owner) ||
    toText(details.owner_detected) ||
    toText(details.owner) ||
    "Não identificado"
  );
};

const extractFileFromAudit = (log: AuditLogEntry) => {
  const details = (log.details || {}) as Record<string, unknown>;
  return toText(details.file_name) || "—";
};

const parseAuditDetails = (log: AuditLogEntry) =>
  (log.details && typeof log.details === "object" ? (log.details as Record<string, unknown>) : {});


const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export function Dashboard() {
  const { user, role, token, signOut } = useAuth();
const handleLogout = async () => {
  try {
    console.log("Tentando deslogar...");
    
    localStorage.clear();
    sessionStorage.clear();

    await signOut();

    window.location.href = appBase() || '/';
    
  } catch (error) {
    console.error("Erro fatal ao sair:", error);
    window.location.href = appBase() || '/';
  }
};
  // ---------------------------
  const [files, setFiles] = useState<File[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("PROCESSANDO...");
  const [analysisMode, setAnalysisMode] = useState<"ai" | "no_ai">("ai");
  /** Banco escolhido pelo usuário no fluxo sem IA (backend usa só esse extractor). */
  const [statementBank, setStatementBank] = useState<
    | "nubank"
    | "itau"
    | "bradesco"
    | "bancodobrasil"
    | "inter"
    | "picpay"
    | "mercadopago"
    | "stone"
    | "sicredi"
    | "neon"
    | "santander"
    | "c6"
    | "caixa"
    | "pan"
    | "pagbank"
  >("nubank");
  const [activePage, setActivePage] = useState<"dashboard" | "logs">("dashboard");
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [selectedAuditEmail, setSelectedAuditEmail] = useState("");
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [showReport, setShowReport] = useState(false);
  const [ignoredPeople, setIgnoredPeople] = useState<string[]>(["", "", "", ""]);
  const [statementOwnerName, setStatementOwnerName] = useState<string>("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [loadingPassword, setLoadingPassword] = useState(false);
  const userEmail = (user?.email || "").trim().toLowerCase();
  const canViewAuditLogs = AUDIT_VIEWERS.has(userEmail);

  const appendLog = (message: string) => {
    const now = new Date().toLocaleTimeString("pt-BR");
    setProcessingLogs((prev) => {
      const next = [...prev, `[${now}] ${message}`];
      return next.slice(-200);
    });
  };

  const postAuditLog = async (
    action: string,
    details: Record<string, unknown> = {},
    statementOwnerOverride?: string
  ) => {
    if (!user?.email) return;
    try {
      await fetch(apiPath("/api/audit-logs"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-actor-email": user.email,
          "x-actor-role": role || "analyst"
        },
        body: JSON.stringify({
          action,
          actor_email: user.email,
          actor_role: role || "analyst",
          statement_owner: statementOwnerOverride ?? statementOwnerName ?? "",
          details
        })
      });
    } catch (error) {
      console.warn("Falha ao registrar auditoria:", error);
    }
  };

  const loadAuditLogs = async () => {
    if (!user?.email || !canViewAuditLogs) return;
    setAuditLoading(true);
    setAuditError("");
    try {
      const response = await fetch(apiPath("/api/audit-logs?limit=150"), {
        headers: { "x-user-email": user.email }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Falha ao carregar auditoria.");
      }
      setAuditLogs(Array.isArray(payload?.logs) ? (payload.logs as AuditLogEntry[]) : []);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro ao carregar logs de auditoria.";
      setAuditError(msg);
    } finally {
      setAuditLoading(false);
    }
  };

  // Admin - gestão de usuários
  const [adminUsers, setAdminUsers] = useState<Array<{ id: string; email: string | null; role: string }>>([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "analyst">("analyst");

  const refreshAdminUsers = async () => {
    if (role !== "admin") return;
    setAdminBusy(true);
    try {
      const resp = await fetch(apiPath("/api/admin-users"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ action: "list" }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || "Falha ao listar usuários.");
      setAdminUsers((data?.users || []) as any);
    } catch (e: any) {
      console.error(e);
      alert("Erro ao listar usuários. Verifique a Edge Function e permissões.");
    }
    setAdminBusy(false);
  };


  const handleUpdatePassword = async () => {
  if (newPassword.length < 8) {
    alert("Mínimo de 8 caracteres!");
    return;
  }
  setLoadingPassword(true);
  try {
    const resp = await fetch(apiPath("/api/admin-users"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({ action: "update-password", new_password: newPassword }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error || "Falha ao atualizar senha.");
    alert("Senha alterada!");
    setShowPasswordModal(false);
    setNewPassword("");
  } catch (e: any) {
    alert("Erro: " + (e?.message || "Falha ao atualizar senha."));
  }
  setLoadingPassword(false);
};
  

  const adminCreateUser = async () => {
    setAdminBusy(true);
    try {
      const resp = await fetch(apiPath("/api/admin-users"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ action: "create", email: newUserEmail, password: newUserPassword, role: newUserRole }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || "Falha ao criar usuário.");
      setNewUserEmail("");
      setNewUserPassword("");
      await refreshAdminUsers();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Erro ao criar usuário.");
    }
    setAdminBusy(false);
  };

  const adminDeleteUser = async (id: string) => {
    if (!confirm("Remover este usuário da equipe?")) return;
    setAdminBusy(true);
    try {
      const resp = await fetch(apiPath("/api/admin-users"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ action: "delete", user_id: id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || "Falha ao remover usuário.");
      await refreshAdminUsers();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Erro ao remover usuário.");
    }
    setAdminBusy(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) {
      return;
    }
    const selected = Array.from(e.target.files).filter((f) => {
      const name = f.name.toLowerCase();
      if (analysisMode === "no_ai") {
        return (
          f.type === "application/pdf" ||
          name.endsWith(".pdf") ||
          name.endsWith(".csv") ||
          name.endsWith(".ofx")
        );
      }
      return f.type === "application/pdf" || name.endsWith(".pdf");
    });
    setFiles((prev) => mergePdfFiles(prev, selected));
    e.target.value = "";
  };


  


  const downloadPDF = () => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 48;
    const contentWidth = pageWidth - margin * 2;
    const lineHeight = 18;
    /** Espaço entre blocos principais (menos “tudo grudado”) */
    const gap = { sm: 12, md: 22, lg: 32, xl: 44 };
    let y = margin;

    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
    };

    const forceNewPage = () => {
      pdf.addPage();
      y = margin;
    };

    const skipDown = (pts: number) => {
      y += pts;
    };

    const formatMonthShortForChart = (monthKey: string) => {
      // monthKey: "MM/YYYY" -> "Jan/26"
      const [mm, yyyy] = monthKey.split("/");
      const monthNum = Number(mm);
      const yearShort = (yyyy || "").slice(-2);
      const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
      const label = monthNum >= 1 && monthNum <= 12 ? months[monthNum - 1] : mm;
      return `${label}/${yearShort || ""}`.replace(/\/$/, "");
    };

    const drawBarChart = () => {
      const n = monthlyLabels.length;
      ensureSpace(220);

      const chartTitle = "Evolução da Renda";
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(51, 65, 85);
      pdf.text(chartTitle, margin, y);
      skipDown(18);

      const chartX = margin;
      const chartY = y;
      const chartW = contentWidth;
      const chartH = 140;
      const pad = 10;
      const axisY = chartY + chartH;

      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.6);
      pdf.roundedRect(chartX, chartY, chartW, chartH, 8, 8);

      if (n === 0) {
        pdf.setTextColor(148, 163, 184);
        pdf.setFontSize(9);
        pdf.text("Sem dados para exibir.", chartX + pad, axisY - 50);
        y = axisY + gap.md;
        return;
      }

      const maxVal = Math.max(...monthlyValues, 0);
      const safeMax = maxVal > 0 ? maxVal : 1;

      pdf.setDrawColor(241, 245, 249);
      pdf.setLineWidth(0.4);
      for (let i = 1; i <= 4; i += 1) {
        const yy = chartY + (chartH * i) / 4;
        pdf.line(chartX + pad, yy, chartX + chartW - pad, yy);
      }

      const slot = chartW / n;
      const barW = slot * 0.58;
      const barColor = [79, 70, 229];

      for (let i = 0; i < n; i += 1) {
        const v = monthlyValues[i] || 0;
        const h = (v / safeMax) * (chartH - pad * 2);
        const x = chartX + i * slot + (slot - barW) / 2;
        const yTop = axisY - pad - h;

        pdf.setFillColor(barColor[0], barColor[1], barColor[2]);
        pdf.roundedRect(x, yTop, barW, h, 3, 3, "F");

        const label = formatMonthShortForChart(monthlyLabels[i]);
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(7.5);
        pdf.text(label, x + barW / 2, axisY + 11, { align: "center" });
      }

      pdf.setTextColor(148, 163, 184);
      pdf.setFontSize(8);
      pdf.text(`Máx. R$ ${money(safeMax).replace("R$ ", "")}`, chartX + pad, chartY + 12);

      y = axisY + gap.md + 6;
    };

    const drawSectionTitle = (title: string, variant: "neutral" | "success" | "danger" = "neutral") => {
      skipDown(gap.sm);
      ensureSpace(48);
      const accent: Record<typeof variant, [number, number, number]> = {
        neutral: [71, 85, 105],
        success: [5, 122, 85],
        danger: [185, 28, 28]
      };
      const rgb = accent[variant];
      pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
      pdf.rect(margin, y - 12, 3, 20, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
      pdf.text(title, margin + 14, y);
      skipDown(12);
      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.5);
      pdf.line(margin, y, pageWidth - margin, y);
      skipDown(gap.md);
    };

    const drawLabelValue = (label: string, value: string) => {
      ensureSpace(lineHeight + 2);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`${label}`, margin, y);
      skipDown(11);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(15, 23, 42);
      const valueLines = pdf.splitTextToSize(value || "-", contentWidth);
      pdf.text(valueLines, margin, y);
      skipDown(valueLines.length * 13 + gap.sm);
    };

    const drawTableHeader = (columns: Array<{ title: string; x: number; align?: "left" | "right" }>) => {
      ensureSpace(30);
      const h = 24;
      pdf.setFillColor(248, 250, 252);
      pdf.roundedRect(margin, y - 8, contentWidth, h, 3, 3, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.setTextColor(71, 85, 105);
      columns.forEach((c) => {
        pdf.text(c.title, c.x, y + 7, { align: c.align || "left" });
      });
      skipDown(h + 4);
    };

    const drawWrappedCellRow = (
      values: Array<{ text: string; x: number; width: number; align?: "left" | "right" }>,
      minHeight = 16
    ) => {
      const splitValues = values.map((v) => ({
        ...v,
        lines: pdf.splitTextToSize(v.text || "-", v.width),
      }));
      const linePitch = 12;
      const rowHeight = Math.max(
        minHeight,
        ...splitValues.map((s) => (Array.isArray(s.lines) ? s.lines.length : 1) * linePitch + 4)
      );
      ensureSpace(rowHeight + gap.sm);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
      pdf.setTextColor(30, 41, 59);

      splitValues.forEach((s) => {
        const lines = Array.isArray(s.lines) ? s.lines : [String(s.lines)];
        if (s.align === "right") {
          pdf.text(lines, s.x, y, { align: "right" });
        } else {
          pdf.text(lines, s.x, y);
        }
      });

      y += rowHeight + 6;
    };

    // Capa / cabeçalho (mais ar)
    const headerH = 100;
    pdf.setFillColor(250, 250, 251);
    pdf.rect(0, y - 6, pageWidth, headerH, "F");
    pdf.setDrawColor(79, 70, 229);
    pdf.setLineWidth(1.25);
    pdf.line(margin, y + headerH - 18, pageWidth - margin, y + headerH - 18);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);
    pdf.setTextColor(15, 23, 42);
    pdf.text("Relatório Financeiro", margin, y + 22);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text("Entradas válidas, médias por ano e origem dos créditos", margin, y + 42);

    y += headerH + gap.md;

    drawLabelValue("Titular do extrato", statementOwnerName || "-");
    drawLabelValue("Analista responsável", user?.email || "-");
    drawLabelValue("Data de geração", new Date().toLocaleString("pt-BR"));
    skipDown(gap.sm);

    drawSectionTitle("Resumo geral", "neutral");
    drawLabelValue("Renda total válida", `R$ ${money(reportMetrics?.total || 0)}`);
    drawLabelValue("Média mensal (todos os meses com movimento)", `R$ ${money(monthAverage || 0)}`);
    yearlyStats.forEach((ys) => {
      drawLabelValue(
        `Média mensal em ${ys.year}`,
        `R$ ${money(ys.monthAverage)} · ${ys.monthsWithData} ${ys.monthsWithData === 1 ? "mês" : "meses"} c/ movimento · total R$ ${money(ys.yearTotal)}`
      );
    });
    drawLabelValue("Melhor mês (entre todos)", `R$ ${money(bestMonth || 0)}`);
    drawLabelValue("Qtd. entradas válidas", String(reportMetrics?.count || 0));
    skipDown(gap.md);

    drawBarChart();
    skipDown(gap.sm);

    drawSectionTitle("Evolução mensal", "neutral");
    if (monthlyLabels.length === 0) {
      drawLabelValue("Observação", "Sem dados mensais para exibir.");
    } else {
      drawTableHeader([
        { title: "Mês", x: margin + 4 },
        { title: "Valor", x: pageWidth - margin - 4, align: "right" },
      ]);
      monthlyLabels.forEach((month, idx) => {
        drawWrappedCellRow([
          { text: formatMonthKey(month), x: margin + 4, width: contentWidth * 0.5 },
          { text: `R$ ${money(Number(monthlyValues[idx] || 0))}`, x: pageWidth - margin - 4, width: contentWidth * 0.4, align: "right" },
        ]);
      });
    }
    skipDown(gap.md);

    if (moneyOriginSummary) {
      const titularShort = (statementOwnerName || "").trim() || "o titular";
      drawSectionTitle("Resumo da maior origem (de quem veio o dinheiro)", "neutral");
      const para =
        moneyOriginSummary.unidentified
          ? `Não foi possível identificar o nome da pessoa ou empresa que mais enviou valor para ${titularShort} ` +
            `(descrições genéricas do banco, ex.: só “PIX” ou “recebida pelo Pix”). ` +
            `Preencha a coluna “Pessoa” nas linhas das entradas válidas na tela principal. ` +
            `Maior bloco sem nome identificado: R$ ${money(moneyOriginSummary.topAmt)} (${moneyOriginSummary.sharePct.toFixed(
              1
            )}% do válido).`
          : `Somando todas as entradas válidas atribuídas à mesma origem, quem mais enviou dinheiro para ${titularShort} foi ` +
            `"${moneyOriginSummary.topKey}", totalizando R$ ${money(moneyOriginSummary.topAmt)} ` +
            `(${moneyOriginSummary.sharePct.toFixed(1)}% do total válido).`;
      const originLines = pdf.splitTextToSize(para, contentWidth);
      ensureSpace(originLines.length * 13 + gap.lg);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      pdf.setTextColor(51, 65, 85);
      pdf.text(originLines, margin, y);
      y += originLines.length * 13 + gap.md;

      drawTableHeader([
        { title: "Origem (pessoa/empresa)", x: margin + 4 },
        { title: "Valor R$", x: pageWidth - margin - 4, align: "right" },
      ]);
      moneyOriginSummary.topSources.forEach((row) => {
        drawWrappedCellRow([
          { text: row.name, x: margin + 4, width: contentWidth * 0.62 },
          {
            text: `R$ ${money(row.amount)} (${row.pct.toFixed(1)}%)`,
            x: pageWidth - margin - 4,
            width: contentWidth * 0.34,
            align: "right",
          },
        ]);
      });
      skipDown(gap.sm);
    }

    skipDown(gap.lg);
    forceNewPage();

    drawSectionTitle("Entradas válidas", "success");
    drawTableHeader([
      { title: "Data", x: margin + 4 },
      { title: "Descrição", x: margin + 70 },
      { title: "Pessoa", x: margin + 290 },
      { title: "Valor", x: pageWidth - margin - 4, align: "right" },
    ]);

    if (validIncomes.length === 0) {
      drawWrappedCellRow([
        { text: "Nenhuma transação válida encontrada.", x: margin + 4, width: contentWidth - 8 },
      ]);
    } else {
      validIncomes.forEach((t) => {
        const cpShow = resolvedCounterparty(t);
        const personText = (t.personName || "").trim()
          ? `${t.personName}${(t.relationship || "").trim() ? ` (${t.relationship})` : ""}`
          : cpShow
            ? cpShow
            : "-";
        drawWrappedCellRow([
          { text: t.date || "-", x: margin + 4, width: 62 },
          { text: t.description || "-", x: margin + 70, width: 210 },
          { text: personText, x: margin + 290, width: 130 },
          { text: `R$ ${money(t.amount)}`, x: pageWidth - margin - 4, width: 100, align: "right" },
        ]);
      });
    }

    skipDown(gap.lg);
    forceNewPage();

    drawSectionTitle("Transações inválidas / desconsideradas", "danger");
    skipDown(gap.sm);

    if (excludedSummaryStats.length > 0) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(71, 85, 105);
      pdf.text("Resumo por motivo", margin, y);
      skipDown(gap.md);
      drawTableHeader([
        { title: "Motivo", x: margin + 4 },
        { title: "Qtd.", x: margin + 300 },
        { title: "Total R$", x: pageWidth - margin - 4, align: "right" },
      ]);
      excludedSummaryStats.forEach((row) => {
        drawWrappedCellRow([
          { text: row.reason, x: margin + 4, width: 250 },
          { text: String(row.count), x: margin + 300, width: 40 },
          { text: `R$ ${money(row.total)}`, x: pageWidth - margin - 4, width: 100, align: "right" },
        ]);
      });
      skipDown(gap.md);
    }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(71, 85, 105);
    pdf.text("Detalhamento (cada linha)", margin, y);
    skipDown(gap.md);

    drawTableHeader([
      { title: "Data", x: margin + 4 },
      { title: "Descrição", x: margin + 70 },
      { title: "Pessoa (Parentesco)", x: margin + 280 },
      { title: "Valor", x: pageWidth - margin - 4, align: "right" },
    ]);

    if (excludedOrDebits.length === 0) {
      drawWrappedCellRow([
        { text: "Nenhum item desconsiderado.", x: margin + 4, width: contentWidth - 8 },
      ]);
    } else {
      excludedOrDebits.forEach((t) => {
        const personText = (t.personName || "").trim()
          ? `${t.personName}${(t.relationship || "").trim() ? ` (${t.relationship})` : ""}`
          : "-";
        const motivo =
          t.isManuallyExcluded
            ? "Excluído manualmente"
            : t.type === "credito"
              ? "Bloqueado por palavra-chave"
              : "Débito";

        drawWrappedCellRow([
          { text: t.date || "-", x: margin + 4, width: 62 },
          { text: `${t.description || "-"} | ${motivo}`, x: margin + 70, width: 190 },
          { text: personText, x: margin + 280, width: 130 },
          { text: `R$ ${money(t.amount)}`, x: pageWidth - margin - 4, width: 100, align: "right" },
        ]);
      });
    }

    const pages = pdf.getNumberOfPages();
    for (let i = 1; i <= pages; i += 1) {
      pdf.setPage(i);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(107, 114, 128);
      pdf.text(`Página ${i} de ${pages}`, pageWidth - margin, pageHeight - 14, { align: "right" });
    }

    const ownerRaw = (statementOwnerName || "").trim() || "CLIENTE";
    const ownerSafe = ownerRaw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

    pdf.save(`RELATORIO-${ownerSafe}.PDF`);
    postAuditLog("report_download_pdf", {
      owner: statementOwnerName || "",
      valid_count: reportMetrics?.count || 0,
      valid_total: reportMetrics?.total || 0
    });
  };


  
  const downloadExcel = () => {
    const now = new Date();
    const filename = `relatorio-financeiro_${now.toLocaleDateString("pt-BR").replace(/\//g, "-")}.xlsx`;

    const wb = XLSX.utils.book_new();

    const sheetValid = XLSX.utils.json_to_sheet(
      validIncomes.map((t) => ({
        Data: t.date,
        Descrição: t.description,
        Valor: t.amount,
        Pessoa: t.personName || "",
        Parentesco: t.relationship || ""
      }))
    );
    XLSX.utils.book_append_sheet(wb, sheetValid, "Entradas");

    const sheetExcluded = XLSX.utils.json_to_sheet(
      excludedOrDebits.map((t) => ({
        Data: t.date,
        Descrição: t.description,
        Valor: t.amount,
        Tipo: t.type,
        Pessoa: t.personName || "",
        Parentesco: t.relationship || "",
        Motivo: t.isManuallyExcluded ? "Excluído manualmente" : (t.type === "credito" ? "Bloqueado por palavra-chave" : "Débito")
      }))
    );
    XLSX.utils.book_append_sheet(wb, sheetExcluded, "Ignorados_Saidas");

    const sheetResumo = XLSX.utils.json_to_sheet(
      reportMetrics
        ? [{
            "Cliente": user?.email || "",
            "Renda Total (válida)": reportMetrics.total,
            "Média mensal (todos os meses c/ movimento)": monthAverage,
            ...Object.fromEntries(
              yearlyStats.map((ys) => [`Média mensal ${ys.year}`, ys.monthAverage])
            ),
            "Melhor mês (válida)": bestMonth,
            "Qtd transações válidas": reportMetrics.count,
            ...(moneyOriginSummary
              ? {
                  "Maior origem (identificação)": moneyOriginSummary.topKey,
                  "Maior origem (valor R$)": moneyOriginSummary.topAmt,
                  "Maior origem (% do total)": Number(moneyOriginSummary.sharePct.toFixed(2))
                }
              : {}),
            "Gerado em": new Date().toLocaleString("pt-BR")
          }]
        : [{
            "Cliente": user?.email || "",
            "Observação": "Sem entradas válidas após filtros/exclusões.",
            "Gerado em": new Date().toLocaleString("pt-BR")
          }]
    );
    XLSX.utils.book_append_sheet(wb, sheetResumo, "Resumo");

    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    downloadBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
    postAuditLog("report_download_excel", {
      owner: statementOwnerName || "",
      valid_count: reportMetrics?.count || 0,
      valid_total: reportMetrics?.total || 0
    });
  };

  

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setLoadingText("PROCESSANDO...");
    setProcessingLogs([]);
    appendLog(`Iniciando análise de ${files.length} arquivo(s)`);
    appendLog(
      analysisMode === "no_ai"
        ? `Modo sem IA — banco: ${statementBank} (só esse parser no servidor)`
        : "Modo selecionado: IA — análise automática"
    );
    postAuditLog("analysis_batch_start", {
      files_count: files.length,
      files: files.map((f) => f.name)
    });
    try {
      let ownerFinal = "";
      let hasDifferentOwners = false;
      const allTransactions: Transaction[] = [];

      for (let idx = 0; idx < files.length; idx += 1) {
        const currentFile = files[idx];
        setLoadingText(`CARREGANDO... ${idx + 1}/${files.length} arquivo(s)`);
        appendLog(`Arquivo ${idx + 1}/${files.length}: ${currentFile.name}`);

        const analyzer = analysisMode === "no_ai" ? analyzeStatementNoAI : analyzeStatement;
        const result = await analyzer(
          currentFile,
          (progress) => {
            setLoadingText(
              `CARREGANDO... analisando páginas ${progress.startPage} a ${progress.endPage} de ${progress.totalPages} (${idx + 1}/${files.length})`
            );
          },
          (logMessage) => appendLog(logMessage),
          {
            actorEmail: user?.email || "",
            actorRole: role || "analyst",
            statementOwner: ownerFinal || statementOwnerName || "",
            fileName: currentFile.name,
            ...(analysisMode === "no_ai" ? { bank: statementBank } : {})
          }
        );

        const isNewShape = typeof result === "object" && result !== null && "transacoes" in (result as any);
        const meta = isNewShape && (result as any).meta ? (result as any).meta : null;
        const owner = isNewShape ? ((result as any).titular || "") : "";
        const txs = isNewShape ? ((result as any).transacoes || []) : (result as any);
        let ownerTrimmed = (owner || "").toString().trim();
        if (!ownerTrimmed && meta?.statement_holder) {
          ownerTrimmed = String(meta.statement_holder).trim();
        }
        if (!ownerTrimmed) {
          ownerTrimmed = extractOwnerFromFileName(currentFile.name);
        }

        if (ownerTrimmed) {
          if (!ownerFinal) ownerFinal = ownerTrimmed;
          else if (normalize(ownerFinal) !== normalize(ownerTrimmed)) hasDifferentOwners = true;
        }

        allTransactions.push(
          ...(txs as Transaction[]).map((t) => {
            const description = String(t.description || "").trim();
            const extractedOrigin = enrichCounterpartyFromDescription(
              description,
              String((t as Transaction).counterparty || "").trim()
            );
            const personName = (t.personName || "").trim() || extractedOrigin;
            return {
              ...t,
              description,
              personName,
              relationship: t.relationship || "",
              counterparty: extractedOrigin
            };
          })
        );
        appendLog(`Arquivo ${currentFile.name}: ${txs.length || 0} transações extraídas`);
        postAuditLog("analysis_file_processed", {
          file_name: currentFile.name,
          extracted_transactions: txs.length || 0,
          file_index: idx + 1,
          files_count: files.length
        }, ownerTrimmed || ownerFinal || statementOwnerName || "");
      }

      setStatementOwnerName(hasDifferentOwners ? "Múltiplos titulares" : ownerFinal);
      setTransactions(allTransactions);
      appendLog(`Concluído: ${allTransactions.length} transações no total`);
      postAuditLog("analysis_batch_finish", {
        files_count: files.length,
        total_transactions: allTransactions.length,
        owner: hasDifferentOwners ? "Múltiplos titulares" : ownerFinal
      }, hasDifferentOwners ? "Múltiplos titulares" : ownerFinal);
      setActiveFilters(new Set());
      setSearchTerm('');
      setShowReport(false);
      setIgnoredPeople(["", "", "", ""]);
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Erro desconhecido ao processar o PDF.";
      alert(
        `${msg}\n\nSe for limite da API (429): aguarde alguns minutos e tente de novo. Opcional: no servidor, várias chaves em GEMINI_API_KEYS (vírgula) reduzem 429.`
      );
      console.error(error);
      appendLog(`Erro: ${msg}`);
      postAuditLog("analysis_batch_error", {
        files_count: files.length,
        error: msg
      });
      setShowReport(false);
    } finally {
      setLoading(false);
      setLoadingText("PROCESSANDO...");
      appendLog("Processamento finalizado");
    }
  };

  const handleToggleReport = () => {
    if (showReport) {
      setShowReport(false);
      postAuditLog("report_close", {
        owner: statementOwnerName || "",
        valid_count: reportMetrics?.count || 0
      });
      return;
    }
    if (!reportMetrics) {
      alert("Não foi possível gerar o relatório analítico com os dados atuais. Voltando para a tela de adição/exclusão para você revisar.");
      setShowReport(false);
      postAuditLog("report_open_blocked", {
        owner: statementOwnerName || "",
        reason: "sem_dados_validos"
      });
      return;
    }
    // Atualiza Pessoa/origem a partir da descrição (ex. REM:) antes de montar o relatório/PDF
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.type !== "credito") return t;
        const extracted = extractBestCounterpartyFromDescription(t.description || "").trim();
        if (!extracted) return t;
        const personName = (t.personName || "").trim();
        const counterparty = (t.counterparty || "").trim();
        if (personName && counterparty === extracted) return t;
        return {
          ...t,
          personName: personName || extracted,
          counterparty: counterparty || extracted
        };
      })
    );
    setShowReport(true);
    postAuditLog("report_open", {
      owner: statementOwnerName || "",
      valid_count: reportMetrics.count,
      valid_total: reportMetrics.total
    });
  };

  const toggleFilter = (keyword: string) => {
    const newFilters = new Set(activeFilters);
    if (newFilters.has(keyword)) newFilters.delete(keyword);
    else newFilters.add(keyword);
    setActiveFilters(newFilters);
  };

  const toggleTransactionState = (id: string) => {
    setTransactions(prev => prev.map(t => {
      if (t.id === id) {
        return { ...t, type: t.type === 'credito' ? 'debito' : 'credito', isManuallyExcluded: !t.isManuallyExcluded };
      }
      return t;
    }));
  };

  const updateTransactionMeta = (id: string, patch: Partial<Transaction>) => {
    setTransactions(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
  };

  const addIgnoredPersonField = () => {
    setIgnoredPeople(prev => [...prev, ""]);
  };

  const setIgnoredPersonAt = (idx: number, value: string) => {
    setIgnoredPeople(prev => prev.map((p, i) => (i === idx ? value : p)));
  };


  

const { validIncomes, excludedOrDebits, totalSum } = useMemo(() => {
  let sum = 0;

  const valid: Transaction[] = [];
  const excluded: Transaction[] = [];

  const ignoredSet = ignoredPeople
    .map((p) => normalize(p))
    .filter((p) => p.length >= 2);

  transactions.forEach(t => {
    const matchesSearch = normalize(t.description).includes(normalize(searchTerm));
    if (!matchesSearch && searchTerm) return;

    const hasKeyword = Array.from(activeFilters).some(filter =>
      normalize(t.description).includes(normalize(filter))
    );

    const matchesIgnoredPerson =
      ignoredSet.length > 0 &&
      ignoredSet.some((p) =>
        normalize(t.personName || "").includes(p) ||
        normalize(t.description).includes(p)
      );

    if (matchesIgnoredPerson) {
      excluded.push({ ...t, isManuallyExcluded: true });
      return;
    }

    if (t.type === 'credito' && !hasKeyword && !t.isManuallyExcluded) {
      valid.push(t);
      sum += t.amount;
    } else {
      excluded.push({
        ...t,
        isManuallyExcluded: t.type === 'credito' && hasKeyword ? true : t.isManuallyExcluded
      });
    }
  });

  return { validIncomes: valid, excludedOrDebits: excluded, totalSum: sum };
}, [transactions, searchTerm, activeFilters, ignoredPeople]);

const reportMetrics = useMemo(() => {

  if (validIncomes.length === 0) return null;

  const total = validIncomes.reduce((sum, t) => sum + t.amount, 0);
  const max = Math.max(...validIncomes.map(t => t.amount));
  const average = total / validIncomes.length;

  return {
    total,
    max,
    average,
    count: validIncomes.length
  };

}, [validIncomes]);

const monthlyData = useMemo(() => {

  const map: Record<string, number> = {};

  validIncomes.forEach(t => {

    const dt = parseBRDate(t.date);
    if (!dt) return;
    const month = `${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
    const key = month;

    if (!map[key]) map[key] = 0;

    map[key] += t.amount;

  });

  const labels = Object.keys(map).sort((a, b) => {
    const [ma, ya] = a.split("/").map(Number);
    const [mb, yb] = b.split("/").map(Number);
    if (ya !== yb) return ya - yb;
    return ma - mb;
  });
  const values = labels.map((k) => map[k]);

  const bestMonth =
    values.length ? Math.max(...values as number[]) : 0;

  const monthAverage =
    values.length
      ? (values as number[]).reduce((a, b) => a + b, 0) / values.length
      : 0;

  const byYear: Record<number, { monthSum: number; monthKeys: Set<string> }> = {};
  labels.forEach((monthKey, idx) => {
    const y = Number(monthKey.split("/")[1]);
    if (!Number.isFinite(y)) return;
    if (!byYear[y]) byYear[y] = { monthSum: 0, monthKeys: new Set() };
    byYear[y].monthSum += values[idx] || 0;
    byYear[y].monthKeys.add(monthKey);
  });

  const yearlyStats: YearlyIncomeStats[] = Object.keys(byYear)
    .map(Number)
    .sort((a, b) => a - b)
    .map((year) => {
      const { monthSum, monthKeys } = byYear[year];
      const monthsWithData = monthKeys.size;
      const monthAverageYear = monthsWithData ? monthSum / monthsWithData : 0;
      return {
        year,
        yearTotal: monthSum,
        monthsWithData,
        monthAverage: monthAverageYear
      };
    });

  return {
    monthlyLabels: labels,
    monthlyValues: values,
    bestMonth,
    monthAverage,
    yearlyStats
  };

}, [validIncomes]);

const {
  monthlyLabels,
  monthlyValues,
  bestMonth,
  monthAverage,
  yearlyStats
} = monthlyData;

const moneyOriginSummary = useMemo(() => {
  if (validIncomes.length === 0) return null;
  const map = new Map<string, number>();
  validIncomes.forEach((t) => {
    const key = incomeSourceKeyForTransaction(t);
    map.set(key, (map.get(key) || 0) + t.amount);
  });
  const total = validIncomes.reduce((s, t) => s + t.amount, 0);
  const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  const topKey = sorted[0]?.[0] || "";
  const topAmt = sorted[0]?.[1] || 0;
  const sharePct = total > 0 ? (topAmt / total) * 100 : 0;
  const unidentified =
    topKey.startsWith("Origem não identificada") || isGenericCounterpartyLabel(topKey);
  const topSources = sorted.slice(0, 5).map(([name, amt]) => ({
    name,
    amount: amt,
    pct: total > 0 ? (amt / total) * 100 : 0
  }));
  return { topKey, topAmt, total, sharePct, unidentified, topSources };
}, [validIncomes]);

const excludedSummaryStats = useMemo(() => {
  if (excludedOrDebits.length === 0) return [];

  const ignoredSet = ignoredPeople
    .map((p) => normalize(p))
    .filter((p) => p.length >= 2);

  const buckets = new Map<string, { count: number; total: number; samples: string[] }>();

  const push = (label: string, amount: number, descSample: string) => {
    const cur = buckets.get(label) || { count: 0, total: 0, samples: [] as string[] };
    cur.count += 1;
    cur.total += amount;
    if (cur.samples.length < 2 && descSample) cur.samples.push(descSample.slice(0, 90));
    buckets.set(label, cur);
  };

  excludedOrDebits.forEach((t) => {
    const nd = normalize(t.description);
    const np = normalize(t.personName || "");
    const ignored =
      ignoredSet.length > 0 &&
      ignoredSet.some((p) => np.includes(p) || nd.includes(p));
    if (ignored) {
      const hit = ignoredSet.find((p) => np.includes(p) || nd.includes(p));
      push(
        `Lista “pessoas a desconsiderar”${hit ? ` — termo “${hit}”` : ""}`,
        t.amount,
        t.description
      );
      return;
    }
    if (t.type === "debito") {
      push("Débito / saída (não entra na renda válida)", t.amount, t.description);
      return;
    }
    const matchedKw = Array.from(activeFilters).filter(
      (k) => normalize(k).length >= 2 && nd.includes(normalize(k))
    );
    if (matchedKw.length) {
      push(`Palavra-chave ativa: ${matchedKw.join(", ")}`, t.amount, t.description);
      return;
    }
    if (t.isManuallyExcluded) {
      push("Excluído manualmente (botão Remover na lista de entradas)", t.amount, t.description);
      return;
    }
    push("Outro motivo", t.amount, t.description);
  });

  return Array.from(buckets.entries())
    .map(([reason, v]) => ({ reason, ...v }))
    .sort((a, b) => b.total - a.total);
}, [excludedOrDebits, activeFilters, ignoredPeople]);

useEffect(() => {
  if (showReport && !reportMetrics) {
    setShowReport(false);
  }
}, [showReport, reportMetrics]);

useEffect(() => {
  if (activePage === "logs" && canViewAuditLogs) {
    loadAuditLogs();
  }
}, [activePage, canViewAuditLogs]);

const monthlySeries = useMemo(() => {
  const monthMap: Record<string, Record<string, number>> = {};

  validIncomes.forEach((t) => {
    const dt = parseBRDate(t.date);
    if (!dt) return;
    const monthKey = `${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
    const dayKey = String(dt.getDate()).padStart(2, "0");
    if (!monthMap[monthKey]) monthMap[monthKey] = {};
    if (!monthMap[monthKey][dayKey]) monthMap[monthKey][dayKey] = 0;
    monthMap[monthKey][dayKey] += t.amount;
  });

  const monthKeys = Object.keys(monthMap).sort((a, b) => {
    const [ma, ya] = a.split("/").map(Number);
    const [mb, yb] = b.split("/").map(Number);
    if (ya !== yb) return ya - yb;
    return ma - mb;
  });

  return monthKeys.map((monthKey) => {
    const days = monthMap[monthKey];
    const labels = Object.keys(days).sort((a, b) => Number(a) - Number(b));
    const values = labels.map((d) => days[d]);
    return { monthKey, labels, values };
  });
}, [validIncomes]);

const auditUserSummaries = useMemo<AuditUserSummary[]>(() => {
  if (auditLogs.length === 0) return [];
  const map = new Map<
    string,
    {
      email: string;
      role: string;
      analysesFinished: number;
      filesProcessed: number;
      reportsOpened: number;
      downloads: number;
      geminiCalls: number;
      lastActivity: string;
      ownersMap: Map<string, number>;
    }
  >();

  auditLogs.forEach((log) => {
    const email = toText(log.actor_email).toLowerCase();
    if (!email) return;
    const roleLabel = toText(log.actor_role) || "analyst";
    const cur =
      map.get(email) ||
      {
        email,
        role: roleLabel,
        analysesFinished: 0,
        filesProcessed: 0,
        reportsOpened: 0,
        downloads: 0,
        geminiCalls: 0,
        lastActivity: log.created_at,
        ownersMap: new Map<string, number>()
      };

    if (!cur.lastActivity || new Date(log.created_at).getTime() > new Date(cur.lastActivity).getTime()) {
      cur.lastActivity = log.created_at;
    }

    if (!cur.role && roleLabel) cur.role = roleLabel;

    if (log.action === "analysis_batch_finish") cur.analysesFinished += 1;
    if (log.action === "analysis_file_processed") cur.filesProcessed += 1;
    if (log.action === "report_open") cur.reportsOpened += 1;
    if (log.action === "report_download_pdf" || log.action === "report_download_excel") cur.downloads += 1;
    if (log.action === "gemini_proxy_call") cur.geminiCalls += 1;

    const details = parseAuditDetails(log);
    const owner = toText(log.statement_owner) || toText(details.owner_detected) || toText(details.owner);
    if (owner && owner.toLowerCase() !== "múltiplos titulares" && owner.toLowerCase() !== "nao identificado" && owner.toLowerCase() !== "não identificado") {
      cur.ownersMap.set(owner, (cur.ownersMap.get(owner) || 0) + 1);
    }

    map.set(email, cur);
  });

  return Array.from(map.values())
    .map((u) => ({
      email: u.email,
      role: u.role || "analyst",
      analysesFinished: u.analysesFinished,
      filesProcessed: u.filesProcessed,
      reportsOpened: u.reportsOpened,
      downloads: u.downloads,
      geminiCalls: u.geminiCalls,
      lastActivity: u.lastActivity,
      owners: Array.from(u.ownersMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
    }))
    .sort((a, b) => {
      if (b.analysesFinished !== a.analysesFinished) return b.analysesFinished - a.analysesFinished;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });
}, [auditLogs]);

const selectedAuditUser = useMemo(
  () => auditUserSummaries.find((u) => u.email === selectedAuditEmail) || auditUserSummaries[0] || null,
  [auditUserSummaries, selectedAuditEmail]
);

useEffect(() => {
  if (!selectedAuditEmail && auditUserSummaries.length > 0) {
    setSelectedAuditEmail(auditUserSummaries[0].email);
  }
  if (selectedAuditEmail && !auditUserSummaries.some((u) => u.email === selectedAuditEmail) && auditUserSummaries.length > 0) {
    setSelectedAuditEmail(auditUserSummaries[0].email);
  }
}, [auditUserSummaries, selectedAuditEmail]);


  const fileAccept = analysisMode === "no_ai" ? ".pdf,.csv,.ofx" : ".pdf";
  const fileHint =
    analysisMode === "no_ai"
      ? "Clique para selecionar PDF/CSV/OFX (modo sem IA)"
      : "Clique para selecionar ou arraste PDF(s)";

  return (
<div className="zelony-page">
<AppNav
  userEmail={user?.email}
  activePage={activePage}
  onTogglePage={() => setActivePage((prev) => (prev === "logs" ? "dashboard" : "logs"))}
  onPassword={() => setShowPasswordModal(true)}
  onLogout={handleLogout}
  loading={loading}
  whatsappUrl={WHATSAPP_SUPPORT_URL}
/>
      
  <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex-1 w-full animate-fade-in">
    {activePage === "logs" ? (
      <div className="zelony-card p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
          <div>
            <h2 className="zelony-section-title">Logs da Plataforma</h2>
            <p className="text-sm text-zelony-muted">
              Aqui você acompanha quem gerou relatório, de qual titular, em qual dia e horário.
            </p>
          </div>
          {canViewAuditLogs && (
            <button
              onClick={loadAuditLogs}
              disabled={auditLoading}
              className="zelony-btn-primary !py-2 !px-4 disabled:opacity-50"
            >
              {auditLoading ? "Atualizando..." : "Atualizar logs"}
            </button>
          )}
        </div>

        {!canViewAuditLogs ? (
          <div className="zelony-alert-warning">
            Você não tem permissão para visualizar a auditoria global.
          </div>
        ) : auditError ? (
          <div className="zelony-alert-error">{auditError}</div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-zelony-border">
              <table className="w-full text-sm">
                <thead className="bg-zelony-surface">
                  <tr>
                    <th className="p-3 text-left font-semibold text-zelony-muted">Data/Hora</th>
                    <th className="p-3 text-left font-semibold text-zelony-muted">Usuário</th>
                    <th className="p-3 text-left font-semibold text-zelony-muted">Ação</th>
                    <th className="p-3 text-left font-semibold text-zelony-muted">Titular do extrato</th>
                    <th className="p-3 text-left font-semibold text-zelony-muted">Arquivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zelony-border-subtle">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-zelony-surface">
                      <td className="p-3 text-zelony-text-secondary">{new Date(log.created_at).toLocaleString("pt-BR")}</td>
                      <td className="p-3 text-zelony-text-secondary">
                        <p className="font-semibold">{log.actor_email}</p>
                        <p className="text-xs text-zelony-muted">{log.actor_role || "sem perfil"}</p>
                      </td>
                      <td className="p-3 text-zelony-text-secondary">{ACTION_LABELS[log.action] || log.action}</td>
                      <td className="p-3 text-zelony-text font-medium">{extractOwnerFromAudit(log)}</td>
                      <td className="p-3 text-zelony-muted">{extractFileFromAudit(log)}</td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && !auditLoading && (
                    <tr>
                      <td className="p-4 text-center text-zelony-muted" colSpan={5}>
                        Nenhum log encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border border-zelony-border p-3 bg-zelony-surface">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-zelony-muted uppercase">Logs da sessão atual</p>
                <button
                  onClick={() => setProcessingLogs([])}
                  className="text-xs px-2 py-1 rounded-md bg-zelony-card border border-zelony-border text-zelony-muted hover:bg-zelony-surface"
                >
                  Limpar
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {processingLogs.length === 0 ? (
                  <p className="text-xs text-zelony-muted">Sem eventos nesta sessão.</p>
                ) : (
                  processingLogs.map((line, idx) => (
                    <p key={`${idx}-${line.slice(0, 20)}`} className="text-xs text-zelony-text-secondary font-mono break-words">
                      {line}
                    </p>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-zelony-border p-4 bg-zelony-card">
              <h3 className="text-sm font-bold text-zelony-text-secondary mb-3">Relatório detalhado por usuário</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-lg border border-zelony-border bg-zelony-surface p-3 max-h-72 overflow-y-auto space-y-2">
                  {auditUserSummaries.length === 0 ? (
                    <p className="text-xs text-zelony-muted">Sem usuários com atividade registrada.</p>
                  ) : (
                    auditUserSummaries.map((u) => (
                      <button
                        key={u.email}
                        type="button"
                        onClick={() => setSelectedAuditEmail(u.email)}
                        className={`w-full text-left rounded-md border px-3 py-2 transition ${
                          selectedAuditUser?.email === u.email
                            ? "border-zelony-gold/40 bg-zelony-brown/20"
                            : "border-zelony-border bg-zelony-card hover:bg-zelony-surface"
                        }`}
                      >
                        <p className="text-sm font-semibold text-zelony-text">{u.email}</p>
                        <p className="text-xs text-zelony-muted">
                          {u.role || "analyst"} · {u.analysesFinished} extratos finalizados
                        </p>
                      </button>
                    ))
                  )}
                </div>

                <div className="rounded-lg border border-zelony-border p-3 bg-zelony-surface">
                  {!selectedAuditUser ? (
                    <p className="text-xs text-zelony-muted">Selecione um usuário para ver o relatório.</p>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-bold text-zelony-text">{selectedAuditUser.email}</p>
                        <p className="text-xs text-zelony-muted">
                          Perfil: {selectedAuditUser.role || "analyst"} · Última atividade:{" "}
                          {new Date(selectedAuditUser.lastActivity).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-md bg-zelony-card border border-zelony-border p-2">
                          <p className="text-zelony-muted">Extratos finalizados</p>
                          <p className="text-lg font-bold text-zelony-text">{selectedAuditUser.analysesFinished}</p>
                        </div>
                        <div className="rounded-md bg-zelony-card border border-zelony-border p-2">
                          <p className="text-zelony-muted">Arquivos processados</p>
                          <p className="text-lg font-bold text-zelony-text">{selectedAuditUser.filesProcessed}</p>
                        </div>
                        <div className="rounded-md bg-zelony-card border border-zelony-border p-2">
                          <p className="text-zelony-muted">Relatórios abertos</p>
                          <p className="text-lg font-bold text-zelony-text">{selectedAuditUser.reportsOpened}</p>
                        </div>
                        <div className="rounded-md bg-zelony-card border border-zelony-border p-2">
                          <p className="text-zelony-muted">Downloads (PDF/Excel)</p>
                          <p className="text-lg font-bold text-zelony-text">{selectedAuditUser.downloads}</p>
                        </div>
                      </div>
                      <div className="rounded-md bg-zelony-card border border-zelony-border p-2">
                        <p className="text-xs font-semibold text-zelony-text-secondary mb-2">Titulares mais analisados</p>
                        {selectedAuditUser.owners.length === 0 ? (
                          <p className="text-xs text-zelony-muted">Sem titular identificado nos logs desse usuário.</p>
                        ) : (
                          <div className="max-h-28 overflow-y-auto space-y-1">
                            {selectedAuditUser.owners.slice(0, 12).map((owner) => (
                              <p key={`${selectedAuditUser.email}-${owner.name}`} className="text-xs text-zelony-text-secondary">
                                {owner.name} — {owner.count} vez(es)
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    ) : (
      <>
    {role === "admin" && (
      <div className="zelony-card p-6 mb-8">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="zelony-section-title text-lg">Gestão de Acesso</h2>
            <p className="text-sm text-zelony-muted mt-1">Criar e remover contas de admins e analistas.</p>
          </div>
          <button
            onClick={refreshAdminUsers}
            disabled={adminBusy}
            className="zelony-btn-secondary disabled:opacity-50"
          >
            {adminBusy ? "Carregando..." : "Atualizar lista"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <input
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            placeholder="email do usuário"
            className="zelony-input !py-2.5"
          />
          <input
            value={newUserPassword}
            onChange={(e) => setNewUserPassword(e.target.value)}
            placeholder="senha (mín. 8)"
            type="password"
            className="zelony-input !py-2.5"
          />
          <select
            value={newUserRole}
            onChange={(e) => setNewUserRole(e.target.value as any)}
            className="zelony-input !py-2.5"
          >
            <option value="analyst">analista</option>
            <option value="admin">admin</option>
          </select>
          <button
            onClick={adminCreateUser}
            disabled={adminBusy}
            className="zelony-btn-primary disabled:opacity-50"
          >
            Cadastrar
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-zelony-border">
          <table className="zelony-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Tipo</th>
                <th className="text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {adminUsers.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 text-sm text-zelony-text">{u.email || u.id}</td>
<td className="px-4 py-3 text-sm text-zelony-text-secondary">
  {u.role === "admin" ? "Administrador" : "Analista"}
</td>                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => adminDeleteUser(u.id)}
                      className="text-sm font-semibold text-red-400 hover:text-red-300"
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
              {adminUsers.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-sm text-zelony-muted">
                    Nenhum usuário listado ainda. Clique em “Atualizar lista”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )}

    <div className="zelony-card-interactive p-6 sm:p-8 mb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h2 className="zelony-section-title">
            Importar Extrato
          </h2>
          <div className="mt-2 space-y-2 max-w-3xl">
            <p className="text-zelony-muted">Envie seu arquivo PDF para processamento</p>
            <p className="text-sm text-zelony-muted">
              Dúvidas ou erro no extrato?{" "}
              <a
                href={WHATSAPP_SUPPORT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
              >
                Fale com o suporte no WhatsApp
              </a>
            </p>
            <p className="text-sm text-red-400 font-medium leading-relaxed">
              <span className="font-semibold">OBS.:</span> Alguns bancos podem apresentar
              falhas. Cabe ao analista realizar a revisão antes de efetuar a entrega.
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-zelony-muted mb-2">
                Análise com IA
              </p>
              <button
                type="button"
                onClick={() => setAnalysisMode("ai")}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
                  analysisMode === "ai"
                    ? "bg-zelony-gold text-zelony-bg border-zelony-gold shadow-sm"
                    : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                }`}
              >
                Usar IA
              </button>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-zelony-muted mb-2">
                Análise sem IA <span className="normal-case font-normal text-zelony-muted">· Leva apenas alguns segundos. Porém, você deverá separar os PDFs por banco e selecionar o banco abaixo.</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("nubank");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "nubank"
                      ? "bg-[#8A05BE] text-zelony-bg border-[#8A05BE] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                >
                  Nubank
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("bradesco");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "bradesco"
                      ? "bg-[#CC092F] text-zelony-bg border-[#CC092F] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                >
                  Bradesco
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("bancodobrasil");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "bancodobrasil"
                      ? "bg-[#F9C700] text-black border-[#F9C700] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                >
                  Banco do Brasil
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("inter");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "inter"
                      ? "bg-[#FF7A00] text-zelony-bg border-[#FF7A00] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                >
                  Inter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("santander");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "santander"
                      ? "bg-[#EC0000] text-zelony-bg border-[#EC0000] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="Santander (sem IA) — Internet Banking ou Consolidado Inteligente"
                >
                  Santander
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("c6");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "c6"
                      ? "bg-[#1A1A1A] text-[#FFD100] border-[#1A1A1A] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="C6 Bank (sem IA)"
                >
                  C6 Bank
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("pan");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "pan"
                      ? "bg-[#007DC6] text-zelony-bg border-[#007DC6] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="Banco Pan (sem IA)"
                >
                  Pan
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("pagbank");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "pagbank"
                      ? "bg-[#00A868] text-zelony-bg border-[#00A868] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="PagBank (sem IA)"
                >
                  PagBank
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("itau");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "itau"
                      ? "bg-[#FF6200] text-zelony-bg border-[#FF6200] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="Itaú (sem IA)"
                >
                  Itaú
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("picpay");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "picpay"
                      ? "bg-[#21C25E] text-zelony-bg border-[#21C25E] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="PicPay (sem IA)"
                >
                  PicPay
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("mercadopago");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "mercadopago"
                      ? "bg-[#009EE3] text-zelony-bg border-[#009EE3] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="Mercado Pago (sem IA)"
                >
                  Mercado Pago
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("stone");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "stone"
                      ? "bg-[#0F3D3A] text-zelony-bg border-[#0F3D3A] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="Stone (sem IA)"
                >
                  Stone
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("sicredi");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "sicredi"
                      ? "bg-[#007A53] text-zelony-bg border-[#007A53] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="Sicredi (sem IA)"
                >
                  Sicredi
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("caixa");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "caixa"
                      ? "bg-[#005CA9] text-zelony-bg border-[#005CA9] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="Caixa Econômica (sem IA — extrato por período)"
                >
                  Caixa
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("no_ai");
                    setStatementBank("neon");
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    analysisMode === "no_ai" && statementBank === "neon"
                      ? "bg-[#1ED760] text-black border-[#1ED760] shadow-sm"
                      : "bg-zelony-card text-zelony-text-secondary border-zelony-border hover:bg-zelony-surface"
                  }`}
                  title="Neon (sem IA)"
                >
                  Neon
                </button>
              </div>
            </div>
          </div>
        </div>

        {transactions.length > 0 && (
          <button 
            onClick={handleToggleReport}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${
              showReport 
              ? 'zelony-btn-secondary !border-zelony-gold/40 !text-zelony-gold !bg-zelony-gold/10' 
              : 'zelony-btn-primary shadow-gold'
            }`}
          >
            {showReport ? 'Visualizar tabelas' : 'Gerar relatório analítico'}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-stretch">
        <div className="flex-1 relative group">
          <input
            type="file"
            accept={fileAccept}
            multiple
            onChange={handleFileChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div className="zelony-dropzone h-full min-h-[88px] flex flex-col items-center justify-center gap-2 group-hover:shadow-gold-sm">
            <span className="text-sm font-medium text-zelony-text-secondary">
              {files.length === 0
                ? fileHint
                : files.length === 1
                  ? files[0].name
                  : `${files.length} arquivos selecionados`}
            </span>
            <span className="text-xs text-zelony-muted">PDF · arraste ou clique para selecionar</span>
          </div>
        </div>

        <button
          onClick={handleUpload}
          disabled={files.length === 0 || loading}
          className="zelony-btn-primary !px-8 !py-4 !text-sm sm:min-w-[200px] shadow-gold disabled:opacity-50 disabled:grayscale"
        >
          <span className="flex items-center justify-center gap-2">
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-zelony-bg/30 border-t-zelony-bg rounded-full animate-spin" />
                {loadingText}
              </>
            ) : (
              'Analisar documento(s)'
            )}
          </span>
        </button>
      </div>

      {files.length > 0 && (
        <div className="mt-3 rounded-xl border border-zelony-border bg-zelony-surface/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zelony-muted mb-2">
            Arquivos selecionados
          </p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {files.map((f, idx) => (
              <p key={`${f.name}-${f.size}-${f.lastModified}`} className="text-sm text-zelony-text-secondary truncate">
                {idx + 1}. {f.name}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
    



{showReport && reportMetrics && (

<div id="report-content" className="zelony-card p-6 sm:p-8 mb-8 animate-fade-in">

<div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-8 pb-6 border-b border-zelony-border-subtle">
<div>
<h1 className="text-2xl sm:text-3xl font-bold text-zelony-text tracking-tight">
Relatório Financeiro Unificado
</h1>
<p className="text-zelony-muted mt-2">
Titular do extrato: <span className="font-semibold text-zelony-gold">{statementOwnerName || "—"}</span>
</p>
<p className="text-zelony-muted text-sm mt-1">
Analista: {user?.email}
</p>
</div>

<div className="flex items-center gap-2 shrink-0">
  <button
    onClick={downloadExcel}
    className="zelony-btn-secondary !border-emerald-500/30 !text-emerald-400 hover:!bg-emerald-500/10"
  >
    Excel
  </button>
  <button
    onClick={downloadPDF}
    className="zelony-btn-primary"
  >
    PDF
  </button>
</div>
</div>

<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
  <div className="zelony-stat-card">
    <p className="zelony-stat-label">Renda total (válida)</p>
    <p className="zelony-stat-value mt-2">R$ {money(reportMetrics.total)}</p>
  </div>
  <div className="zelony-stat-card">
    <p className="zelony-stat-label">Média mensal (todos os meses)</p>
    <p className="zelony-stat-value mt-2">R$ {money(monthAverage)}</p>
  </div>
  <div className="zelony-stat-card sm:col-span-2 lg:col-span-1">
    <p className="zelony-stat-label">Melhor mês</p>
    <p className="zelony-stat-value mt-2 text-zelony-gold">R$ {money(bestMonth)}</p>
  </div>
</div>

{yearlyStats.length > 0 && (
  <div className="mb-8">
    <h3 className="zelony-stat-label mb-4">Média por ano (IR vs extrato)</h3>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {yearlyStats.map((ys) => (
        <div
          key={ys.year}
          className="zelony-stat-card !border-emerald-500/20 !bg-emerald-950/15"
        >
          <p className="text-xs font-semibold text-emerald-400">Média mensal em {ys.year}</p>
          <p className="text-2xl font-bold text-emerald-300 mt-1">R$ {money(ys.monthAverage)}</p>
          <p className="text-xs text-emerald-400/70 mt-2">
            {ys.monthsWithData} {ys.monthsWithData === 1 ? "mês" : "meses"} com movimento · total R${" "}
            {money(ys.yearTotal)}
          </p>
        </div>
      ))}
    </div>
    <p className="text-xs text-zelony-muted mt-3">
      Compare a média do ano com o valor declarado no IR: diferenças grandes podem indicar inconsistência.
    </p>
  </div>
)}

{moneyOriginSummary && (
  <div className="mb-10 rounded-2xl border border-zelony-gold/20 bg-zelony-brown/10 p-6">
    <h3 className="zelony-stat-label !text-zelony-gold mb-3">
      De quem veio o dinheiro (maior origem)
    </h3>
    {moneyOriginSummary.unidentified ? (
      <p className="text-zelony-text-secondary leading-relaxed text-sm">
        No modo <span className="font-semibold">sem IA</span>, o nome só aparece se o PDF trouxer na descrição (ex.{" "}
        <span className="font-mono text-sm">REM: NOME</span> no Bradesco,{" "}
        <span className="font-mono text-sm">Cp: …-NOME</span> no Inter, ou nome após “Pix recebido”). Se o banco só
        mostra texto genérico (<span className="font-mono text-sm">TRANSFERENCIA PIX</span>,{" "}
        <span className="font-mono text-sm">CENTRAL/INTERNET/APP</span>), não há nome para extrair — use o modo{" "}
        <span className="font-semibold">com IA</span> ou preencha a coluna{" "}
        <span className="font-semibold">Pessoa</span> em{" "}
        <span className="font-semibold">Visualizar tabelas</span>. Maior bloco sem nome:{" "}
        <span className="font-semibold">R$ {money(moneyOriginSummary.topAmt)}</span> (
        {moneyOriginSummary.sharePct.toFixed(1)}% do válido).
      </p>
    ) : (
      <p className="text-zelony-text-secondary leading-relaxed text-sm">
        Somando créditos da mesma origem, quem mais enviou dinheiro para{" "}
        <span className="font-semibold">{statementOwnerName || "o titular"}</span> foi{" "}
        <span className="font-semibold text-amber-100">{moneyOriginSummary.topKey}</span>, totalizando{" "}
        <span className="font-semibold">R$ {money(moneyOriginSummary.topAmt)}</span> (
        {moneyOriginSummary.sharePct.toFixed(1)}% do total válido).
      </p>
    )}
    <div className="mt-4 overflow-x-auto rounded-xl border border-zelony-border">
      <table className="zelony-table">
        <thead>
          <tr className="!bg-zelony-brown/20">
            <th>Origem (pessoa / empresa)</th>
            <th className="text-right">Valor</th>
            <th className="text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {moneyOriginSummary.topSources.map((row) => (
            <tr key={row.name}>
              <td className="!text-zelony-text">{row.name}</td>
              <td className="text-right font-medium !text-zelony-gold">R$ {money(row.amount)}</td>
              <td className="text-right !text-zelony-muted">{row.pct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}

{excludedSummaryStats.length > 0 && (
  <div className="mb-10 rounded-2xl border border-red-500/20 bg-red-950/15 p-6">
    <h3 className="zelony-stat-label !text-red-400 mb-2">
      Resumo dos desconsiderados (por motivo)
    </h3>
    <p className="text-sm text-red-300/80 mb-4">
      Valores e quantidades das linhas que não entram nas entradas válidas, agrupadas pelo motivo.
    </p>
    <div className="overflow-x-auto rounded-xl border border-red-500/15">
      <table className="zelony-table">
        <thead>
          <tr className="!bg-red-950/30">
            <th className="!text-red-300">Motivo</th>
            <th className="text-right !text-red-300">Qtd.</th>
            <th className="text-right !text-red-300">Total R$</th>
          </tr>
        </thead>
        <tbody>
          {excludedSummaryStats.map((row) => (
            <tr key={row.reason}>
              <td className="!text-zelony-text-secondary">{row.reason}</td>
              <td className="text-right">{row.count}</td>
              <td className="text-right font-medium !text-red-300">R$ {money(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="mt-4">
      <p className="text-xs font-semibold text-zelony-muted mb-2">Exemplos de descrições (amostra)</p>
      <ul className="text-xs text-zelony-text-secondary space-y-1 list-disc list-inside">
        {excludedSummaryStats
          .flatMap((row) => row.samples.map((s, i) => ({ row, s, i })))
          .slice(0, 8)
          .map(({ row, s, i }) => (
            <li key={`${row.reason}-${i}-${s.slice(0, 12)}`}>
              <span className="text-zelony-muted">[{row.reason.slice(0, 40)}]</span> {s}
            </li>
          ))}
      </ul>
    </div>
  </div>
)}

<div className="flex items-center justify-between text-xs text-zelony-muted mb-6">
  <p>Base: {reportMetrics.count} entradas válidas (após filtros e exclusões)</p>
  <p>Gerado em: {new Date().toLocaleString("pt-BR")}</p>
</div>


<h2 className="zelony-section-title text-lg mb-4">
Resumo Geral
</h2>

<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">

<div className="zelony-stat-card">
<p className="zelony-stat-label">Renda total</p>
<p className="zelony-stat-value mt-1">
R$ {money(reportMetrics.total)}
</p>
</div>

<div className="zelony-stat-card">
<p className="zelony-stat-label">Média mensal</p>
<p className="zelony-stat-value mt-1">
R$ {money(monthAverage)}
</p>
</div>

<div className="zelony-stat-card">
<p className="zelony-stat-label">Melhor mês</p>
<p className="zelony-stat-value mt-1 text-zelony-gold">
R$ {money(bestMonth)}
</p>
</div>

</div>



<h2 className="zelony-section-title text-lg mb-4">
Evolução da Renda
</h2>

<div className="w-full rounded-2xl border border-zelony-border bg-zelony-surface/40 p-4 sm:p-6">
  {monthlyLabels.length <= 1 ? (
    <div className="h-64">
      <Bar
        options={chartOptions}
        data={{
          labels: monthlyLabels.map(formatMonthKey),
          datasets: [
            {
              label: "Renda",
              data: monthlyValues,
              backgroundColor: CHART_GOLD,
              borderRadius: 6,
            }
          ]
        }}
      />
    </div>
  ) : (
    <div className="space-y-8">
      {monthlySeries.map((s) => (
        <div key={s.monthKey}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-zelony-text">Mês {formatMonthKey(s.monthKey)}</h3>
            <p className="text-sm text-zelony-gold font-medium">Soma: R$ {money(s.values.reduce((a, b) => a + b, 0))}</p>
          </div>
          <div className="h-64">
            <Bar
              options={{
                ...chartOptions,
                scales: {
                  ...chartOptions.scales,
                  x: { ...chartOptions.scales.x, title: { display: true, text: "Dia", color: "#71717a" } },
                  y: { ...chartOptions.scales.y, title: { display: true, text: "R$", color: "#71717a" } },
                },
              }}
              data={{
                labels: s.labels,
                datasets: [
                  {
                    label: "Renda diária (somada)",
                    data: s.values,
                    backgroundColor: CHART_GOLD_DIM,
                    borderColor: CHART_GOLD,
                    borderWidth: 1,
                    borderRadius: 4,
                  }
                ]
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )}
</div>



<h2 className="zelony-section-title text-lg mt-10 mb-4">
Transações
</h2>

<div className="overflow-x-auto rounded-xl border border-zelony-border">
<table className="zelony-table">

<thead>
<tr>
<th>Data</th>
<th>Descrição</th>
<th>Pessoa (Parentesco)</th>
<th className="text-right">Valor</th>
</tr>
</thead>

<tbody>

{validIncomes.map((t) => {
  const cp = resolvedCounterparty(t);
  return (
<tr key={t.id}>
<td>{t.date}</td>
<td>{t.description}</td>
<td>
  {(t.personName || "").trim() ? (
    `${t.personName}${(t.relationship || "").trim() ? ` (${t.relationship})` : ""}`
  ) : cp ? (
    <span className="text-zelony-gold" title="Identificado automaticamente pela descrição do extrato">
      {cp}
    </span>
  ) : (
    <span className="text-zelony-muted text-sm">—</span>
  )}
</td>
<td className="text-right font-medium text-emerald-400">
R$ {money(t.amount)}
</td>
</tr>
);
})}

</tbody>

</table>
</div>


<p className="text-sm text-zelony-muted mt-6 text-center">
Baseado em {reportMetrics.count} transações válidas analisadas.
</p>

<p className="text-sm text-zelony-muted mt-2 text-center">
Gerado em: {new Date().toLocaleDateString("pt-BR")}
</p>

</div>

)}


        {!showReport && transactions.length > 0 && (
          <>
            <div className="zelony-card p-6 mb-6">
              <h2 className="zelony-section-title text-lg mb-5">Filtros de Bloqueio</h2>

              <div className="mb-5">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <p className="zelony-label !mb-0">Pessoas a desconsiderar</p>
                  <button
                    type="button"
                    onClick={addIgnoredPersonField}
                    className="zelony-btn-ghost !text-xs"
                    title="Adicionar mais um campo"
                  >
                    Adicionar
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {ignoredPeople.map((p, idx) => (
                    <input
                      key={idx}
                      value={p}
                      onChange={(e) => setIgnoredPersonAt(idx, e.target.value)}
                      placeholder={`Pessoa ${idx + 1} (ex: João, Maria)`}
                      className="zelony-input !py-2.5"
                    />
                  ))}
                </div>
                <p className="text-xs text-zelony-muted mt-2">
                  Se o nome aparecer na descrição ou no campo Pessoa, a transação é movida para Ignorados automaticamente.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 mb-5">
                {EXCLUDE_KEYWORDS.map((keyword) => (
                  <button
                    key={keyword}
                    onClick={() => toggleFilter(keyword)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      activeFilters.has(keyword) ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'zelony-btn-secondary !py-1.5 !px-3 !text-xs'
                    }`}
                  >
                    {activeFilters.has(keyword) ? "× " : ""}{keyword}
                  </button>
                ))}
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar transações..."
                  className="zelony-input"
                />
              </div>
            </div>

            <div className="zelony-card overflow-hidden mb-6 border-l-4 border-l-emerald-500/60">
<div className="zelony-panel-header-success">
  <div>
    <h2 className="text-lg font-bold text-emerald-300">Entradas Válidas</h2>
    <p className="text-2xl sm:text-3xl font-bold text-emerald-400 mt-1">
      R$ {totalSum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
    </p>
  </div>
                <span className="zelony-badge-gold !text-emerald-400 !bg-emerald-500/10 !border-emerald-500/30">
                  {validIncomes.length} itens
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="zelony-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th>Pessoa</th>
                      <th>Parentesco</th>
                      <th className="text-right">Valor</th>
                      <th className="text-center">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validIncomes.map((t) => {
                      const cp = resolvedCounterparty(t);
                      return (
                      <tr key={t.id} className="hover:bg-zelony-surface transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-zelony-text">{t.date}</td>
                        <td className="px-6 py-4 text-sm text-zelony-text">{t.description}</td>
                        <td className="px-6 py-4 text-sm text-zelony-text">
                          <input
                            value={t.personName || ""}
                            onChange={(e) => updateTransactionMeta(t.id, { personName: e.target.value })}
                            placeholder={cp ? `ex: ${cp}` : "Nome de quem enviou"}
                            className="w-44 px-2 py-1 border border-zelony-border rounded-md"
                          />
                          {cp ? (
                            <p className="text-[10px] text-zelony-gold mt-1 max-w-[11rem] leading-tight">
                              Sugestão: {cp}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-6 py-4 text-sm text-zelony-text">
                          <select
                            value={t.relationship || ""}
                            onChange={(e) => updateTransactionMeta(t.id, { relationship: e.target.value })}
                            className="w-40 px-2 py-1 border border-zelony-border rounded-md bg-zelony-card"
                          >
                            {relationshipOptions.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt ? opt : "—"}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="text-right font-medium text-emerald-400">
                          + R$ {t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="text-center">
                          <button
                            onClick={() => toggleTransactionState(t.id)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition"
                            title="Mover para excluídos"
                          >
                            Remover
                          </button>
                        </td>
                      </tr>
                    );
                    })}
                    {validIncomes.length === 0 && (
                      <tr><td colSpan={6} className="px-6 py-8 text-center text-zelony-muted">Nenhuma entrada encontrada.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="zelony-card overflow-hidden border-l-4 border-l-red-500/50">
              <div className="zelony-panel-header-danger">
                <div>
                  <h2 className="text-lg font-bold text-red-300">Transações inválidas / ignoradas</h2>
                  <p className="text-sm text-red-400/70 mt-1">A IA errou? Restaure uma transação clicando no botão ao lado.</p>
                </div>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/15 text-red-300 border border-red-500/25">
                  {excludedOrDebits.length} itens
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="zelony-table">
                  <thead>
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-zelony-muted uppercase tracking-wider">Data</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-zelony-muted uppercase tracking-wider">Descrição</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-zelony-muted uppercase tracking-wider">Pessoa</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-zelony-muted uppercase tracking-wider">Parentesco</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-zelony-muted uppercase tracking-wider">Valor</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-zelony-muted uppercase tracking-wider">Motivo</th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-zelony-muted uppercase tracking-wider">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zelony-border-subtle opacity-80">
                    {excludedOrDebits.map((t) => {
                      const blockKw = Array.from(activeFilters).find((filter) =>
                        normalize(t.description).includes(normalize(filter))
                      );
                      let motivo = "Identificado como Débito";
                      if (t.isManuallyExcluded) motivo = "Excluído Manualmente";
                      else if (blockKw) motivo = `Filtro de Bloqueio: ${blockKw}`;
                      else if (t.type === 'credito') motivo = "Bloqueado por Palavra-chave";

                      const cp = resolvedCounterparty(t);

                      return (
                        <tr key={t.id} className="hover:bg-zelony-surface transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-zelony-text">{t.date}</td>
                          <td className="px-6 py-4 text-sm text-zelony-text">{t.description}</td>
                          <td className="px-6 py-4 text-sm text-zelony-text">
                            <input
                              value={t.personName || ""}
                              onChange={(e) => updateTransactionMeta(t.id, { personName: e.target.value })}
                              placeholder={cp ? `ex: ${cp}` : "Nome"}
                              className="w-40 px-2 py-1 border border-zelony-border rounded-md"
                            />
                            {cp ? (
                              <p className="text-[10px] text-zelony-gold mt-1 max-w-[11rem] leading-tight">
                                Sugestão: {cp}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-6 py-4 text-sm text-zelony-text">
                            <select
                              value={t.relationship || ""}
                              onChange={(e) => updateTransactionMeta(t.id, { relationship: e.target.value })}
                              className="w-40 px-2 py-1 border border-zelony-border rounded-md bg-zelony-card"
                            >
                              {relationshipOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt ? opt : "—"}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-6 py-4 text-sm text-right font-medium text-zelony-muted">
                            R$ {t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="text-sm text-amber-400/90">{motivo}</td>
                          <td className="px-6 py-4 text-center">
                            <button
                              onClick={() => toggleTransactionState(t.id)}
                              className="flex items-center justify-center gap-1 mx-auto text-xs px-3 py-1 bg-zelony-brown/20 border border-zelony-gold/30 text-zelony-gold rounded-md hover:bg-zelony-brown/30 transition"
                            >
                              Forçar Entrada
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

      </>
    )}

        {showPasswordModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-fade-in">
            <div className="zelony-card p-6 sm:p-8 w-full max-w-md shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-zelony-gold/60 to-transparent" />
              <h2 className="text-xl font-bold mb-1 flex items-center gap-2 text-zelony-text">
                Alterar Senha
              </h2>
              <p className="text-sm text-zelony-muted mb-5">Mínimo de 8 caracteres</p>
              <input
                type="password"
                placeholder="Nova senha"
                className="zelony-input mb-5"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPasswordModal(false)}
                  className="zelony-btn-secondary flex-1"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleUpdatePassword}
                  disabled={loadingPassword}
                  className="zelony-btn-primary flex-1 disabled:opacity-50"
                >
                  {loadingPassword ? "Salvando..." : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {activePage === "dashboard" && (
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-zelony-border bg-zelony-surface/50 px-5 py-4">
            <p className="text-sm text-zelony-text-secondary text-center sm:text-left">
              Dúvidas sobre extratos? Nosso suporte responde pelo WhatsApp.
            </p>
            <a
              href={WHATSAPP_SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="zelony-btn-secondary !border-emerald-500/30 !text-emerald-400 hover:!bg-emerald-500/10 shrink-0"
            >
              Abrir WhatsApp
            </a>
          </div>
        )}
      </main>

      <CreditsFooter className="border-t border-zelony-border-subtle mt-auto" />
    </div>
  );
}
