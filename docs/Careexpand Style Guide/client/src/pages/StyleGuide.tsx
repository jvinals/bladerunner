import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, Users, Calendar, FileText, BarChart2, Settings, Shield,
  ChevronRight, Bell, CreditCard, Activity, Thermometer, Heart, Download,
  CheckCircle, AlertCircle, Info, Plus, Search, X, Check, Mail, Lock,
  Eye, EyeOff, Phone, MessageSquare, Video, PlayCircle, FileBarChart,
  ChevronDown, ChevronUp, ChevronsUpDown, ArrowUpDown,
  Globe, MapPin
} from "lucide-react";

// ─── Color data ───────────────────────────────────────────────────────────────
const PRIMARY_PALETTE = [
  { name: "Primary Blue", hex: "#4B90FF", textDark: false },
  { name: "Accent Blue", hex: "#4D65FF", textDark: false },
  { name: "Background", hex: "#FAFAFA", textDark: true, border: true },
  { name: "White", hex: "#FFFFFF", textDark: true, border: true },
  { name: "Muted", hex: "#727273", textDark: false },
];

const NEUTRAL_SCALE = [
  "#080404", "#373757", "#404040", "#757373",
  "#A3A3A3", "#D4D4D4", "#E3E3E3", "#F5F5F5", "#FAFAFA",
];

const SEMANTIC_COLORS = [
  { name: "Primary Blue", hex: "#4D65FF", desc: "Info, interactive" },
  { name: "Success", hex: "#56A34A", desc: "Confirmed, active" },
  { name: "Warning", hex: "#EAB508", desc: "Caution, pending" },
  { name: "Destructive", hex: "#FF4D4D", desc: "Errors, critical" },
];

const EMAIL_SIG_HTML = `<div style="font-family: Inter, Arial, sans-serif; padding: 24px 28px; border: 1px solid #E5E5E5; border-radius: 8px; width: 560px; max-width: 100%;">
  <table cellpadding="0" cellspacing="0" border="0" style="font-family: Inter, Arial, sans-serif;">
    <tr>
      <td style="padding-right: 20px; vertical-align: top;">
        <img src="https://www.careexpand.com/style-guide/careexpand_logo_exact.svg" alt="Careexpand" width="31" height="31" style="display: block;" />
      </td>
      <td>
        <div style="font-size: 18px; font-weight: 700; color: #0a0a0a; line-height: 1.2; letter-spacing: -0.3px;">John Doecex</div>
        <div style="font-size: 13px; font-weight: 500; color: #489DFF; line-height: 1.2; margin-top: 2px;">Backend Engineer</div>
        <div style="margin-top: 8px;">
          <div style="font-size: 13px; color: #737373; margin-bottom: 4px;">☎ (469) 213-5555</div>
          <div style="font-size: 13px; color: #737373; margin-bottom: 4px;">✉ john@careexpand.com</div>
          <div style="font-size: 13px; margin-bottom: 4px;"><a href="https://www.careexpand.com" style="color: #489DFF; text-decoration: none; font-weight: 500;">🌐 www.careexpand.com</a></div>
          <div style="font-size: 13px; color: #737373;">📍 5830 Granite Parkway STE 100-296, Plano TX 75024</div>
        </div>
      </td>
    </tr>
  </table>
</div>`;

const EMAIL_SIG_HTML_SMALL = `<div style="font-family: Inter, Arial, sans-serif; padding: 16px 20px; border: 1px solid #E5E5E5; border-radius: 6px; width: 380px; max-width: 100%;">
  <table cellpadding="0" cellspacing="0" border="0" style="font-family: Inter, Arial, sans-serif;">
    <tr>
      <td style="padding-right: 12px; vertical-align: top;">
        <img src="https://www.careexpand.com/style-guide/careexpand_logo_exact.svg" alt="Careexpand" width="24" height="24" style="display: block;" />
      </td>
      <td>
        <div style="font-size: 14px; font-weight: 700; color: #0a0a0a; line-height: 1.2; letter-spacing: -0.2px;">John Doecex</div>
        <div style="font-size: 11px; font-weight: 500; color: #489DFF; line-height: 1.2; margin-top: 2px;">Backend Engineer</div>
        <div style="margin-top: 6px;">
          <div style="font-size: 11px; color: #737373; margin-bottom: 2px;">☎ (469) 213-5555</div>
          <div style="font-size: 11px; color: #737373; margin-bottom: 2px;">✉ john@careexpand.com</div>
          <div style="font-size: 11px; margin-bottom: 2px;"><a href="https://www.careexpand.com" style="color: #489DFF; text-decoration: none; font-weight: 500;">🌐 www.careexpand.com</a></div>
          <div style="font-size: 11px; color: #737373;">📍 5830 Granite Parkway STE 100-296, Plano TX 75024</div>
        </div>
      </td>
    </tr>
  </table>
</div>`;

const TOKEN_TABLE = [
  { token: "--color-primary", hex: "#4B90FF", usage: "Main interactive elements, links, active states" },
  { token: "--color-accent", hex: "#4D65FF", usage: "Highlights, CTAs, accent backgrounds" },
  { token: "--color-background", hex: "#FAFAFA", usage: "App background" },
  { token: "--color-white", hex: "#FFFFFF", usage: "Card surfaces, modals" },
  { token: "--color-muted", hex: "#727273", usage: "Subdued text, disabled states" },
  { token: "--color-success", hex: "#56A34A", usage: "Confirmed, active, positive" },
  { token: "--color-warning", hex: "#EAB508", usage: "Caution, pending states" },
  { token: "--color-destructive", hex: "#FF4D4D", usage: "Errors, deletions, critical alerts" },
];

// ─── Spacing data ─────────────────────────────────────────────────────────────
const SPACING = [
  { px: 4, label: "Tight", token: "--space-tight" },
  { px: 8, label: "Small", token: "--space-small" },
  { px: 12, label: "Base", token: "--space-base" },
  { px: 16, label: "Medium", token: "--space-medium" },
  { px: 24, label: "Large", token: "--space-large" },
  { px: 32, label: "XL", token: "--space-xl" },
  { px: 48, label: "XXL", token: "--space-xxl" },
];

const RADII = [
  { px: 0, label: "None", desc: "Tables, strict containers" },
  { px: 4, label: "Small", desc: "Small badges, chips" },
  { px: 6, label: "Base", desc: "Buttons, inputs" },
  { px: 8, label: "Medium", desc: "Cards, modals" },
  { px: 16, label: "Large", desc: "Dialogs, grid" },
  { px: 9999, label: "Full", desc: "Avatars, circular elements" },
];

// ─── Nav sections ─────────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    group: "FOUNDATION",
    items: [
      { id: "brand", label: "Brand Identity" },
      { id: "colors", label: "Color System" },
      { id: "typography", label: "Typography" },
      { id: "spacing", label: "Spacing & Layout" },
    ],
  },
  {
    group: "COMPONENTS",
    items: [
      { id: "buttons", label: "Buttons" },
      { id: "inputs", label: "Form Inputs" },
      { id: "badges", label: "Badges & Tags" },
      { id: "cards", label: "Cards" },
      { id: "controls", label: "Controls" },
    ],
  },
  {
    group: "PATTERNS",
    items: [
      { id: "dialogs", label: "Dialogs & Modals" },
      { id: "navigation", label: "Navigation" },
      { id: "dropdowns", label: "Dropdowns & Pickers" },
      { id: "alerts", label: "Alerts & Feedback" },
    ],
  },
  {
    group: "DATA",
    items: [
      { id: "tables", label: "Data Tables" },
      { id: "advanced", label: "Advanced Tables" },
      { id: "auth", label: "Auth Forms" },
      { id: "email-signature", label: "Email Signature" },
    ],
  },
  {
    group: "PRINCIPLES",
    items: [{ id: "principles", label: "Design Principles" }],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function SectionHeader({ id, label, title, desc }: { id: string; label: string; title: string; desc?: string }) {
  return (
    <div className="mb-8">
      <p className="ce-section-label mb-2">{label}</p>
      <h2 className="text-3xl font-bold text-gray-900 mb-3">{title}</h2>
      {desc && <p className="text-gray-500 text-sm leading-[1.2] max-w-2xl">{desc}</p>}
    </div>
  );
}

function SubHeader({ title }: { title: string }) {
  return <h3 className="text-base font-semibold text-gray-800 mb-4">{title}</h3>;
}

function SectionDivider() {
  return <hr className="border-gray-100 my-12" />;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function StyleGuide() {
  const [activeSection, setActiveSection] = useState("brand");
  const [activeTab, setActiveTab] = useState("overview");
  const [showPassword, setShowPassword] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState<string | null>("q1");
  const [expandedRow, setExpandedRow] = useState<number | null>(1);
  const [toggle1, setToggle1] = useState(true);
  const [toggle2, setToggle2] = useState(false);
  const [toggle3, setToggle3] = useState(true);
  const [sliderVal, setSliderVal] = useState(65);
  const [emailError, setEmailError] = useState(true);
  const [emailSigCopied, setEmailSigCopied] = useState(false);
  const [emailSigSmallCopied, setEmailSigSmallCopied] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  // Scroll spy
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActiveSection(e.target.id);
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );
    document.querySelectorAll("section[id]").forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex min-h-screen bg-[#FAFAFA]" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* ── Sidebar ── */}
      <aside className="w-56 shrink-0 bg-white border-r border-gray-100 sticky top-0 h-screen flex flex-col overflow-y-auto">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-100">
          <span className="text-[#4B90FF] font-bold text-lg tracking-tight">Careexpand</span>
          <p className="text-[10px] text-gray-400 mt-0.5">Style Guide</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.group}>
              <p className="text-[10px] font-semibold text-gray-400 tracking-widest uppercase px-2 mb-2">
                {section.group}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => scrollTo(item.id)}
                      className={`w-full text-left text-sm px-3 py-1.5 rounded-md transition-colors ${
                        activeSection === item.id
                          ? "bg-blue-50 text-[#4B90FF] font-medium"
                          : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                      }`}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-[#4B90FF] text-xs font-bold">
            JD
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-700 truncate">Jon Doe</p>
            <p className="text-[10px] text-gray-400 truncate">jon@acmecorp.com</p>
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-10 py-4 flex items-center justify-between">
          <span className="text-[#4B90FF] font-bold text-base tracking-tight">Careexpand</span>
          <span className="text-xs font-semibold text-gray-400 tracking-widest uppercase">Style Guide</span>
        </header>

        <div className="px-10 py-10 max-w-5xl space-y-0">

          {/* ═══════════════════════════════════════════════════════════ BRAND */}
          <section id="brand" className="scroll-mt-20 pb-12">
            <SectionHeader id="brand" label="Brand Identity" title="Careexpand" desc='The operating system for continuity of care. Careexpand is a SaaS healthcare platform built on clean minimalism, professional trust, and systematic design — delivering a clinical yet approachable experience for providers and patients alike.' />
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <p className="text-xs text-gray-400 mb-2">Brand Name</p>
                <p className="text-2xl font-bold text-[#4B90FF]">Careexpand</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <p className="text-xs text-gray-400 mb-2">Tagline</p>
                <p className="text-base text-gray-700 italic">"The operating system for continuity of care"</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <p className="text-xs text-gray-400 mb-2">Tone of Voice</p>
                <p className="text-sm text-gray-600">Clean • Professional • Trustworthy • Clinical but approachable</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <p className="text-xs text-gray-400 mb-2">Design Foundation</p>
                <p className="text-sm text-gray-600">Built on the <strong>shadcn/ui</strong> design system. Tokens over hardcoded values. Components over custom layouts.</p>
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ═══════════════════════════════════════════════════════════ COLORS */}
          <section id="colors" className="scroll-mt-20 pb-12">
            <SectionHeader id="colors" label="Color System" title="Color Palette" desc="A soft, approachable palette built on true tones with a distinctive accent. Inspired by Careexpand's clean healthcare aesthetic." />

            <SubHeader title="Primary Palette" />
            <div className="flex gap-3 mb-8 flex-wrap">
              {PRIMARY_PALETTE.map((c) => (
                <div key={c.hex} className="flex flex-col gap-1.5">
                  <div
                    className="w-28 h-16 rounded-lg"
                    style={{ background: c.hex, border: c.border ? "1px solid #E3E3E3" : undefined }}
                  />
                  <p className="text-xs font-medium text-gray-700">{c.name}</p>
                  <p className="text-[11px] text-gray-400 ce-mono">{c.hex}</p>
                </div>
              ))}
            </div>

            <SubHeader title="Neutral Scale" />
            <div className="flex gap-2 mb-8 flex-wrap">
              {NEUTRAL_SCALE.map((hex) => (
                <div key={hex} className="flex flex-col gap-1">
                  <div className="w-16 h-10 rounded-md" style={{ background: hex, border: hex === "#FAFAFA" || hex === "#F5F5F5" ? "1px solid #E3E3E3" : undefined }} />
                  <p className="text-[10px] text-gray-400 ce-mono">{hex}</p>
                </div>
              ))}
            </div>

            <SubHeader title="Semantic & Accent Colors" />
            <div className="flex gap-4 mb-8 flex-wrap">
              {SEMANTIC_COLORS.map((c) => (
                <div key={c.hex} className="flex flex-col gap-1.5">
                  <div className="w-36 h-14 rounded-lg" style={{ background: c.hex }} />
                  <p className="text-xs font-medium text-gray-700">{c.name}</p>
                  <p className="text-[11px] text-gray-400 ce-mono">{c.hex} — {c.desc}</p>
                </div>
              ))}
            </div>

            <SubHeader title="Color Token Reference" />
            <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Token</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Hex</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {TOKEN_TABLE.map((row, i) => (
                    <tr key={row.token} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-sm border border-gray-200" style={{ background: row.hex }} />
                          <code className="text-xs ce-mono text-gray-600">{row.token}</code>
                        </div>
                      </td>
                      <td className="px-4 py-3 ce-mono text-xs text-gray-500">{row.hex}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{row.usage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <SectionDivider />

          {/* ═══════════════════════════════════════════════════════ TYPOGRAPHY */}
          <section id="typography" className="scroll-mt-20 pb-12">
            <SectionHeader id="typography" label="Typography" title="Type System" desc="Inter serves as the primary typeface — clean, geometric, and highly legible across all sizes. JetBrains Mono provides a technical monospaced counterpart for data, codes, and labels." />

            <div className="bg-white border border-gray-100 rounded-lg p-8 space-y-6 mb-6">
              <div className="flex items-end justify-between border-b border-gray-50 pb-6">
                <span className="text-[48px] font-bold text-[#4B90FF] leading-none">Display Large</span>
                <span className="text-xs text-gray-400 text-right">48px / Bold<br />Tracking: 1px</span>
              </div>
              <div className="flex items-end justify-between border-b border-gray-50 pb-5">
                <span className="text-[36px] font-semibold text-[#4B90FF] leading-none">Heading 1</span>
                <span className="text-xs text-gray-400 text-right">36px / Semibold<br />Tracking: -0.5px</span>
              </div>
              <div className="flex items-end justify-between border-b border-gray-50 pb-4">
                <div className="flex items-baseline gap-3">
                  <span className="text-[24px] font-semibold text-[#4B90FF]">Heading 2</span>
                  <span className="text-xs text-gray-400">24px / Semibold</span>
                </div>
                <span className="text-xs text-gray-400">24px / Semibold</span>
              </div>
              <div className="flex items-end justify-between border-b border-gray-50 pb-4">
                <div className="flex items-baseline gap-3">
                  <span className="text-[18px] font-semibold text-[#4B90FF]">Heading 3</span>
                  <span className="text-xs text-gray-400">18px / Semibold</span>
                </div>
                <span className="text-xs text-gray-400">18px / Semibold</span>
              </div>
              <div className="flex items-end justify-between border-b border-gray-50 pb-4">
                <p className="text-[16px] text-[#4B90FF] leading-[1.2] max-w-lg">
                  Body text provides readable content at comfortable sizes for long-form reading and interface descriptions.
                </p>
                <span className="text-xs text-gray-400 text-right shrink-0 ml-4">16px / Regular<br />Line height: 1.2</span>
              </div>
              <div className="flex items-end justify-between border-b border-gray-50 pb-4">
                <div className="flex items-baseline gap-3">
                  <span className="text-[13px] text-gray-500">Caption and helper text for supplementary information</span>
                  <span className="text-[11px] text-gray-400">13px / Regular</span>
                </div>
                <span className="text-xs text-gray-400">13px / Regular</span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 tracking-[0.12em] uppercase">Section Label — None 469</p>
                  <p className="text-[11px] text-gray-400 mt-1">Tracking: 2px / uppercase</p>
                </div>
                <span className="text-xs text-gray-400 text-right">11px / Semibold<br />Tracking: 2px</span>
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-lg p-6">
              <p className="text-xs font-semibold text-gray-500 mb-4">Monospace — JetBrains Mono</p>
              <div className="space-y-2">
                {[
                  ["PT-2026-04221", "Patient ID"],
                  ["STMT-2024-002", "Statement Number"],
                  ["#4B90FF", "Color Token"],
                  ["12/31/1979 (46y)", "Date of Birth"],
                ].map(([val, label]) => (
                  <div key={val} className="flex items-center gap-6">
                    <code className="ce-mono text-sm text-gray-700 w-44">{val}</code>
                    <span className="text-xs text-gray-400">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════════════ SPACING */}
          <section id="spacing" className="scroll-mt-20 pb-12">
            <SectionHeader id="spacing" label="Spacing & Layout" title="Spacing & Radius" desc="A base-4 spacing system ensures consistent rhythm across all components. Corner radius tokens define the visual softness of each element type." />
            <div className="grid grid-cols-2 gap-10">
              <div>
                <SubHeader title="Spacing Scale" />
                <div className="space-y-3">
                  {SPACING.map((s) => (
                    <div key={s.px} className="flex items-center gap-4">
                      <div className="w-1 rounded-sm bg-[#4B90FF]" style={{ height: s.px }} />
                      <div className="w-16 h-1 rounded-sm bg-[#4B90FF]" style={{ width: s.px * 2 }} />
                      <span className="text-sm text-gray-600">{s.px}px — {s.label}</span>
                      <code className="text-xs text-gray-400 ce-mono">{s.token}</code>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <SubHeader title="Corner Radius Scale" />
                <div className="space-y-4">
                  {RADII.map((r) => (
                    <div key={r.px} className="flex items-center gap-4">
                      <div
                        className="w-12 h-8 border-2 border-[#4B90FF] bg-blue-50 shrink-0"
                        style={{ borderRadius: r.px === 9999 ? "9999px" : `${r.px}px` }}
                      />
                      <div>
                        <span className="text-sm text-gray-700">{r.label}</span>
                        <span className="text-xs text-gray-400 ml-2">{r.px === 9999 ? "9999px" : `${r.px}px`}</span>
                        <p className="text-xs text-gray-400">{r.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════════════ BUTTONS */}
          <section id="buttons" className="scroll-mt-20 pb-12">
            <SectionHeader id="buttons" label="Components" title="Buttons" desc="Core button variants styled with the Careexpand palette. All variants support default and small sizes, with icon + label patterns." />

            <SubHeader title="Default Size — Solid Variants" />
            <div className="flex flex-wrap gap-3 mb-6">
              <button className="flex items-center gap-1.5 px-4 py-2 bg-[#4B90FF] text-white text-sm font-medium rounded-md hover:bg-blue-500 transition-colors"><Plus size={14} /> Primary</button>
              <button className="flex items-center gap-1.5 px-4 py-2 bg-[#4D65FF] text-white text-sm font-medium rounded-md hover:opacity-90 transition-colors"><Plus size={14} /> Accent</button>
              <button className="flex items-center gap-1.5 px-4 py-2 bg-[#FF4D4D] text-white text-sm font-medium rounded-md hover:opacity-90 transition-colors"><Plus size={14} /> Destructive</button>
              <button className="flex items-center gap-1.5 px-4 py-2 border border-[#4B90FF] text-[#4B90FF] text-sm font-medium rounded-md hover:bg-blue-50 transition-colors"><Plus size={14} /> Outline</button>
              <button className="flex items-center gap-1.5 px-4 py-2 text-gray-600 text-sm font-medium rounded-md hover:bg-gray-100 transition-colors"><Plus size={14} /> Ghost</button>
              <button className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-400 text-sm font-medium rounded-md cursor-not-allowed" disabled><Plus size={14} /> Disabled</button>
            </div>

            <SubHeader title="Small Size" />
            <div className="flex flex-wrap gap-2 mb-6">
              <button className="flex items-center gap-1 px-3 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md"><Plus size={12} /> Primary</button>
              <button className="flex items-center gap-1 px-3 py-1.5 bg-[#4D65FF] text-white text-xs font-medium rounded-md"><Plus size={12} /> Accent</button>
              <button className="flex items-center gap-1 px-3 py-1.5 bg-[#FF4D4D] text-white text-xs font-medium rounded-md"><Plus size={12} /> Destructive</button>
              <button className="flex items-center gap-1 px-3 py-1.5 border border-[#4B90FF] text-[#4B90FF] text-xs font-medium rounded-md"><Plus size={12} /> Outline</button>
              <button className="flex items-center gap-1 px-3 py-1.5 text-gray-600 text-xs font-medium rounded-md hover:bg-gray-100"><Plus size={12} /> Ghost</button>
              <button className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-400 text-xs font-medium rounded-md cursor-not-allowed" disabled><Plus size={12} /> Disabled</button>
            </div>

            <SubHeader title="Contextual Action Buttons (from Data Table)" />
            <div className="flex flex-wrap gap-2">
              {[
                { icon: <CreditCard size={13} />, label: "Facturación" },
                { icon: <FileBarChart size={13} />, label: "Resumen" },
                { icon: <Phone size={13} />, label: "Llamar al Paciente" },
                { icon: <MessageSquare size={13} />, label: "Mensajes" },
                { icon: <Video size={13} />, label: "Ir al Encuentro" },
              ].map((b) => (
                <button key={b.label} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors">
                  {b.icon} {b.label}
                </button>
              ))}
              <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md">
                <PlayCircle size={13} /> Iniciar Encuentro
              </button>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════════ FORM INPUTS */}
          <section id="inputs" className="scroll-mt-20 pb-12">
            <SectionHeader id="inputs" label="Components" title="Form Inputs" desc="All inputs use 6px border radius, subtle border (#D4D4D4), and a Primary Blue focus state. Labels appear above inputs in Primary Blue." />

            <div className="grid grid-cols-2 gap-6">
              {/* Text default */}
              <div>
                <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Label Text</label>
                <input type="text" placeholder="Placeholder" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]" />
              </div>

              {/* Text filled */}
              <div>
                <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Label Text</label>
                <input type="text" defaultValue="Input Value" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]" />
              </div>

              {/* Email with error */}
              <div>
                <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Email address</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                  <input
                    type="email"
                    defaultValue="invalid-email"
                    className="w-full border border-[#FF4D4D] rounded-md pl-9 pr-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-100"
                  />
                </div>
                <p className="text-xs text-[#FF4D4D] mt-1">Please enter a valid email address</p>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Password</label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    className="w-full border border-gray-200 rounded-md pl-9 pr-9 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]"
                  />
                  <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Select */}
              <div>
                <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Label Text</label>
                <div className="relative">
                  <select className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-500 appearance-none focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF] bg-white">
                    <option value="">Select Option</option>
                    <option>Cardiology</option>
                    <option>Neurology</option>
                    <option>Orthopedics</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Textarea */}
              <div>
                <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Label Text</label>
                <textarea placeholder="Placeholder" rows={3} className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF] resize-none" />
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Appointment Date</label>
                <input type="date" defaultValue="2026-03-15" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]" />
              </div>

              {/* Time */}
              <div>
                <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Time Slot</label>
                <input type="time" defaultValue="10:00" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]" />
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════════════ BADGES */}
          <section id="badges" className="scroll-mt-20 pb-12">
            <SectionHeader id="badges" label="Components" title="Badges & Tags" desc="Pill-shaped badges with 16px border radius for status indicators, category labels, and count displays." />

            <SubHeader title="Outlined Variants" />
            <div className="flex flex-wrap gap-2 mb-6">
              {[
                { label: "Default", color: "#4B90FF" },
                { label: "Success", color: "#56A34A" },
                { label: "Warning", color: "#EAB508" },
                { label: "Destructive", color: "#FF4D4D" },
                { label: "Muted", color: "#727273" },
              ].map((b) => (
                <span key={b.label} className="px-3 py-1 rounded-full text-xs font-medium border" style={{ color: b.color, borderColor: b.color }}>
                  {b.label}
                </span>
              ))}
            </div>

            <SubHeader title="Solid Variants (Status Badges)" />
            <div className="flex flex-wrap gap-2 mb-6">
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#56A34A] text-white">Confirmed</span>
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#EAB508] text-white">Pending</span>
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#404040] text-white">Closed</span>
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#FF4D4D] text-white">Expired</span>
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#4B90FF] text-white">Active</span>
            </div>

            <SubHeader title="Count Badges" />
            <div className="flex flex-wrap gap-4">
              {[
                { label: "Citas", count: 2 },
                { label: "Notifications", count: 5 },
                { label: "Superbills", count: 12 },
              ].map((b) => (
                <div key={b.label} className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-700">{b.label}</span>
                  <span className="w-5 h-5 rounded-full bg-[#4B90FF] text-white text-[10px] font-bold flex items-center justify-center">{b.count}</span>
                </div>
              ))}
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════════════ CARDS */}
          <section id="cards" className="scroll-mt-20 pb-12">
            <SectionHeader id="cards" label="Components" title="Cards" desc="Card components for displaying metrics, content, and patient information. All cards use 8px border radius and white background." />

            <SubHeader title="Stat Cards" />
            <div className="grid grid-cols-4 gap-4 mb-8">
              {[
                { label: "Total Payments", value: "6", sub: null },
                { label: "Total Paid", value: "$23,800", sub: null, accent: true },
                { label: "Total Billed", value: "$28,600", sub: null, accent: true },
                { label: "Claims Count", value: "24", sub: "+7%" },
              ].map((c) => (
                <div key={c.label} className="bg-white border border-gray-100 rounded-lg p-4">
                  <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-2">{c.label}</p>
                  <p className={`text-2xl font-bold ${c.accent ? "text-[#4B90FF]" : "text-gray-800"}`}>{c.value}</p>
                  {c.sub && <span className="inline-block mt-2 px-2 py-0.5 bg-green-100 text-green-600 text-[10px] font-semibold rounded-full">{c.sub}</span>}
                </div>
              ))}
            </div>

            <SubHeader title="Content Cards" />
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <p className="text-sm font-semibold text-gray-700 mb-4">Active Rovers</p>
                <p className="text-3xl font-bold text-gray-800 mb-2">1,280</p>
                <span className="px-2 py-0.5 bg-[#4B90FF] text-white text-[10px] font-semibold rounded-full">72%</span>
              </div>
              <div className="bg-white border border-gray-100 rounded-lg p-5 flex flex-col justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#4B90FF] mb-2">Solar Efficiency Pack</p>
                  <p className="text-sm text-gray-500 leading-[1.2]">Boosts rover endurance by optimizing solar panel alignment.</p>
                </div>
                <button className="flex items-center gap-1.5 text-sm text-[#4B90FF] font-medium mt-4 hover:underline">
                  <Plus size={14} /> Request
                </button>
              </div>
            </div>

            <SubHeader title="Patient Card (Complex)" />
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-100 text-[#4B90FF] text-sm font-bold flex items-center justify-center">SJ</div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Sarah Johnson</p>
                      <p className="text-xs text-gray-400 ce-mono">PT-2026-04221</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 bg-[#56A34A] text-white text-[10px] font-semibold rounded-full">Active</span>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { icon: <Activity size={14} />, val: "120/80", label: "Blood Pressure" },
                    { icon: <Heart size={14} />, val: "72 bpm", label: "Heart Rate" },
                    { icon: <Thermometer size={14} />, val: "98.6°F", label: "Temperature" },
                  ].map((v) => (
                    <div key={v.label} className="text-center">
                      <div className="flex justify-center text-[#4B90FF] mb-1">{v.icon}</div>
                      <p className="text-base font-bold text-gray-800">{v.val}</p>
                      <p className="text-[10px] text-gray-400">{v.label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors">View History</button>
                  <button className="flex-1 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md hover:bg-blue-500 transition-colors">Schedule Visit</button>
                </div>
              </div>

              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-gray-800">Upcoming Appointments</p>
                  <p className="text-xs text-gray-400">Next 7 days</p>
                </div>
                <div className="space-y-3 mb-4">
                  {[
                    { time: "10:30 AM", doc: "Dr. Michael Chen", type: "Annual Checkup", date: "Mar 15", status: "Confirmed", statusColor: "#56A34A" },
                    { time: "2:30 PM", doc: "Dr. Sarah Williams", type: "Lab Review", date: "Mar 17", status: "Pending", statusColor: "#EAB508" },
                  ].map((a) => (
                    <div key={a.type} className="flex items-center justify-between py-2 border-b border-gray-50">
                      <div>
                        <p className="text-xs font-medium text-gray-700">{a.time} — {a.doc}</p>
                        <p className="text-[11px] text-gray-400">{a.type} · {a.date}</p>
                      </div>
                      <span className="text-[11px] font-medium" style={{ color: a.statusColor }}>{a.status}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors">View All</button>
                  <button className="flex-1 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md hover:bg-blue-500 transition-colors">New Appointment</button>
                </div>
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════════ CONTROLS */}
          <section id="controls" className="scroll-mt-20 pb-12">
            <SectionHeader id="controls" label="Components" title="Controls" desc="Interactive form controls including toggles, radios, checkboxes, and sliders — all using the Primary Blue accent color." />

            <SubHeader title="Toggle Switches" />
            <div className="flex flex-wrap gap-6 mb-6">
              {[
                { val: toggle1, set: setToggle1, label: "Label Text" },
                { val: toggle2, set: setToggle2, label: "Label Text" },
                { val: toggle3, set: setToggle3, label: "Label Text" },
              ].map((t, i) => (
                <label key={i} className="flex items-center gap-2 cursor-pointer">
                  <div
                    className="relative w-9 h-5 rounded-full transition-colors"
                    style={{ background: t.val ? "#4B90FF" : "#D4D4D4" }}
                    onClick={() => t.set(!t.val)}
                  >
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" style={{ transform: t.val ? "translateX(16px)" : "translateX(0)" }} />
                  </div>
                  <span className="text-sm text-gray-600">{t.label}</span>
                </label>
              ))}
            </div>

            <SubHeader title="Radio Buttons" />
            <div className="flex flex-wrap gap-4 mb-6">
              {["Option A", "Option B", "Option C"].map((opt, i) => (
                <label key={opt} className="flex items-center gap-2 cursor-pointer">
                  <div className="w-4 h-4 rounded-full border-2 border-[#4B90FF] flex items-center justify-center">
                    {i === 0 && <div className="w-2 h-2 rounded-full bg-[#4B90FF]" />}
                  </div>
                  <span className="text-sm text-gray-600">{opt}</span>
                </label>
              ))}
            </div>

            <SubHeader title="Checkboxes" />
            <div className="flex flex-wrap gap-4 mb-6">
              {[
                { label: "Checked", checked: true },
                { label: "Unchecked", checked: false },
              ].map((c) => (
                <label key={c.label} className="flex items-center gap-2 cursor-pointer">
                  <div className="w-4 h-4 rounded border-2 border-[#4B90FF] flex items-center justify-center" style={{ background: c.checked ? "#4B90FF" : "white" }}>
                    {c.checked && <Check size={10} className="text-white" strokeWidth={3} />}
                  </div>
                  <span className="text-sm text-gray-600">{c.label}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 cursor-pointer">
                <div className="w-4 h-4 rounded border-2 border-gray-300 flex items-center justify-center bg-white" />
                <span className="text-sm text-gray-600">I agree to the <a href="#" className="text-[#4B90FF] underline">Terms of Service and Privacy Policy</a></span>
              </label>
            </div>

            <SubHeader title="Slider / Range Input" />
            <div className="max-w-xs">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>0</span>
                <span className="text-[#4B90FF] font-medium">{sliderVal}%</span>
                <span>100</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={sliderVal}
                onChange={(e) => setSliderVal(+e.target.value)}
                className="w-full accent-[#4B90FF]"
              />
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════════ DIALOGS */}
          <section id="dialogs" className="scroll-mt-20 pb-12">
            <SectionHeader id="dialogs" label="Patterns" title="Dialogs & Modals" desc="Confirmation dialogs and modal overlays for critical user actions. Use modals sparingly for focused tasks." />

            <div className="grid grid-cols-3 gap-4">
              {/* Confirm */}
              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <p className="text-sm font-semibold text-[#4B90FF] mb-2">Confirm Appointment</p>
                <p className="text-xs text-gray-500 mb-4">Are you sure you want to schedule this appointment for March 15, 2026 at 10:00 AM?</p>
                <div className="flex gap-2">
                  <button className="px-4 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md">Confirm</button>
                  <button className="px-4 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md">Cancel</button>
                </div>
              </div>

              {/* Transfer */}
              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <p className="text-sm font-semibold text-[#4B90FF] mb-2">Patient Transfer</p>
                <p className="text-xs text-gray-500 mb-4">Transfer patient records to another provider. This action requires authorization.</p>
                <input type="text" placeholder="Enter authorization code" className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-xs text-gray-600 placeholder-gray-300 mb-3 focus:outline-none focus:border-[#4B90FF]" />
                <div className="flex gap-2">
                  <button className="flex-1 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md flex items-center justify-center gap-1"><Plus size={11} /> Transfer Now</button>
                  <button className="flex-1 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md">Review First</button>
                </div>
              </div>

              {/* 2FA */}
              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <div className="flex justify-center mb-3">
                  <div className="w-10 h-10 rounded-full border-2 border-[#4B90FF]/30 flex items-center justify-center">
                    <Shield size={18} className="text-[#4B90FF]" />
                  </div>
                </div>
                <p className="text-xs text-gray-500 text-center mb-3">Secure your account with an additional verification step.</p>
                <div className="bg-blue-50 rounded-md h-8 mb-3" />
                <div className="flex gap-2">
                  <button className="flex-1 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md flex items-center justify-center gap-1"><Plus size={11} /> Enable 2FA</button>
                  <button className="flex-1 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md">Skip for Now</button>
                </div>
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════════ NAVIGATION */}
          <section id="navigation" className="scroll-mt-20 pb-12">
            <SectionHeader id="navigation" label="Patterns" title="Navigation" desc="Tabbed interfaces and sidebar navigation for organizing content and primary application routing." />

            <SubHeader title="Tabs — Patient Record" />
            <div className="bg-white border border-gray-100 rounded-lg overflow-hidden mb-8">
              <div className="flex border-b border-gray-100">
                {["Overview", "Vitals", "Medications", "Lab Results", "Notes"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab.toLowerCase().replace(" ", "-"))}
                    className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.toLowerCase().replace(" ", "-")
                        ? "border-[#4B90FF] text-[#4B90FF]"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="p-6">
                <p className="text-sm font-semibold text-[#4B90FF] mb-4">Patient Information</p>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Full Name", value: "Sarah Johnson", accent: true },
                    { label: "Patient ID", value: "PT-2026-04221", accent: true },
                    { label: "Date of Birth", value: "March 12, 1985", accent: true },
                    { label: "Insurance", value: "Blue Cross PPO", accent: true },
                    { label: "Primary Provider", value: "Dr. Michael Chen", accent: true },
                  ].map((f) => (
                    <div key={f.label}>
                      <p className="text-xs text-gray-400 mb-0.5">{f.label}</p>
                      <p className={`text-sm ${f.accent ? "text-[#4B90FF]" : "text-gray-700"}`}>{f.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <SubHeader title="Sidebar Navigation" />
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-white border border-gray-100 rounded-lg overflow-hidden" style={{ height: 420 }}>
                {/* Sidebar header */}
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-[#4B90FF]">Careexpand</p>
                  </div>
                </div>
                {/* Org */}
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center">
                    <Settings size={12} className="text-gray-500" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-700">Acme, Inc.</p>
                    <p className="text-[10px] text-gray-400">Enterprise</p>
                  </div>
                </div>
                {/* Nav items */}
                <div className="py-2 px-2 flex-1 overflow-y-auto">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2 py-1">Clinical</p>
                  {[
                    { icon: <LayoutDashboard size={14} />, label: "Dashboard", active: true },
                    { icon: <Users size={14} />, label: "Patients" },
                    { icon: <Calendar size={14} />, label: "Appointments" },
                    { icon: <FileText size={14} />, label: "Records" },
                  ].map((item) => (
                    <div key={item.label} className={`flex items-center justify-between px-3 py-2 rounded-md mb-0.5 ${item.active ? "bg-blue-50 text-[#4B90FF]" : "text-gray-500 hover:bg-gray-50"}`}>
                      <div className="flex items-center gap-2.5">
                        {item.icon}
                        <span className="text-xs font-medium">{item.label}</span>
                      </div>
                      <ChevronRight size={12} className="opacity-40" />
                    </div>
                  ))}
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2 py-1 mt-2">Administration</p>
                  {[
                    { icon: <BarChart2 size={14} />, label: "Analytics" },
                    { icon: <Settings size={14} />, label: "Settings" },
                    { icon: <Shield size={14} />, label: "Compliance" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between px-3 py-2 rounded-md mb-0.5 text-gray-500 hover:bg-gray-50">
                      <div className="flex items-center gap-2.5">
                        {item.icon}
                        <span className="text-xs font-medium">{item.label}</span>
                      </div>
                      <ChevronRight size={12} className="opacity-40" />
                    </div>
                  ))}
                </div>
                {/* Footer */}
                <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 mt-auto">
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-[#4B90FF] text-[10px] font-bold flex items-center justify-center">JD</div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700">Jon Doe</p>
                    <p className="text-[10px] text-gray-400 truncate">jon@acmecorp.com</p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-100 rounded-lg p-5">
                <p className="text-sm font-semibold text-gray-800 mb-4">Sidebar Anatomy</p>
                <ul className="space-y-3 text-sm text-gray-600">
                  {[
                    { bullet: "●", color: "#4B90FF", text: <><strong>Header</strong> — Brand logo, app name, and collapse toggle</> },
                    { bullet: "●", color: "#4B90FF", text: <><strong>Section Titles</strong> — Uppercase labels grouping nav items</> },
                    { bullet: "●", color: "#4B90FF", text: <><strong>Active Item</strong> — Highlighted with accent background</> },
                    { bullet: "●", color: "#4B90FF", text: <><strong>Default Items</strong> — Icon + label, hover reveals accent</> },
                    { bullet: "●", color: "#4B90FF", text: <><strong>Footer</strong> — User avatar, name, and options menu</> },
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span style={{ color: item.color }} className="text-xs mt-0.5">●</span>
                      <span className="text-xs text-gray-600">{item.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════ DROPDOWNS */}
          <section id="dropdowns" className="scroll-mt-20 pb-12">
            <SectionHeader id="dropdowns" label="Patterns" title="Dropdowns & Pickers" desc="Selection menus for choosing from predefined options. Combines search, titles, dividers, and checkable items." />

            <div className="grid grid-cols-3 gap-6">
              {/* Search dropdown */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-3">Search Dropdown</p>
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
                    <Search size={13} className="text-gray-400" />
                    <input type="text" placeholder="Search..." className="text-xs text-gray-600 outline-none flex-1 placeholder-gray-300" />
                  </div>
                  <div className="py-1">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-1.5">Departments</p>
                    {["Cardiology", "Neurology", "Orthopedics"].map((d, i) => (
                      <div key={d} className="flex items-center justify-between px-3 py-1.5 hover:bg-blue-50">
                        <div className="flex items-center gap-2">
                          {i === 0 && <Check size={11} className="text-[#4B90FF]" />}
                          {i !== 0 && <div className="w-[11px]" />}
                          <span className="text-xs text-gray-600">{d}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400">0.9%</span>
                          <ChevronRight size={11} className="text-gray-300" />
                        </div>
                      </div>
                    ))}
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-1.5 mt-1">Specialties</p>
                    {["Pediatrics", "Radiology"].map((d) => (
                      <div key={d} className="flex items-center justify-between px-3 py-1.5 hover:bg-blue-50">
                        <div className="flex items-center gap-2">
                          <div className="w-[11px]" />
                          <span className="text-xs text-gray-600">{d}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400">0.9%</span>
                          <ChevronRight size={11} className="text-gray-300" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Provider combobox */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-3">Provider Combobox</p>
                <div>
                  <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Label Text</label>
                  <div className="relative mb-3">
                    <select className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-500 appearance-none focus:outline-none focus:border-[#4B90FF] bg-white">
                      <option>Select Option</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
                      <Search size={12} className="text-gray-400" />
                      <span className="text-xs text-gray-600 flex-1">Dr. Chen</span>
                      <X size={12} className="text-gray-300" />
                    </div>
                    {[
                      { initials: "MC", name: "Dr. Michael Chen", code: "0.R4", checked: true },
                      { initials: "SW", name: "Dr. Sarah Williams", code: "0.R4" },
                      { initials: "JP", name: "Dr. James Park", code: "0.R4" },
                    ].map((p) => (
                      <div key={p.name} className="flex items-center justify-between px-3 py-2 hover:bg-blue-50">
                        <div className="flex items-center gap-2">
                          {p.checked && <Check size={11} className="text-[#4B90FF]" />}
                          {!p.checked && <div className="w-[11px]" />}
                          <div className="w-5 h-5 rounded-full bg-blue-100 text-[#4B90FF] text-[9px] font-bold flex items-center justify-center">{p.initials}</div>
                          <span className="text-xs text-gray-600">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400">{p.code}</span>
                          <ChevronRight size={11} className="text-gray-300" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Form pickers */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-3">Form Pickers</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Department</label>
                    <div className="relative">
                      <select className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-600 appearance-none focus:outline-none focus:border-[#4B90FF] bg-white">
                        <option>Cardiology</option>
                        <option>Neurology</option>
                      </select>
                      <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Priority</label>
                    <div className="relative">
                      <select className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-500 appearance-none focus:outline-none focus:border-[#4B90FF] bg-white">
                        <option value="">Select Option</option>
                        <option>High</option>
                        <option>Medium</option>
                        <option>Low</option>
                      </select>
                      <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Appointment Date</label>
                    <input type="date" defaultValue="2026-03-15" className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-600 focus:outline-none focus:border-[#4B90FF]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Time Slot</label>
                    <input type="time" defaultValue="10:00" className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-600 focus:outline-none focus:border-[#4B90FF]" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════════ ALERTS */}
          <section id="alerts" className="scroll-mt-20 pb-12">
            <SectionHeader id="alerts" label="Patterns" title="Alerts & Feedback" desc="Contextual feedback components for informing users of status, warnings, and important messages." />

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-lg">
                <CheckCircle size={16} className="text-[#4B90FF] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-[#4B90FF]">Appointment Confirmed</p>
                  <p className="text-xs text-gray-500 mt-0.5">Your appointment with Dr. Chen has been scheduled for March 15 at 10:00 AM.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-lg">
                <AlertCircle size={16} className="text-[#FF4D4D] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-[#FF4D4D]">Insurance Expired</p>
                  <p className="text-xs text-gray-500 mt-0.5">Patient insurance coverage expired on Feb 1, 2026. Please update before next visit.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div>
                <SubHeader title="Progress Indicators" />
                <div className="space-y-4">
                  {[
                    { label: "Onboarding Progress", pct: 75 },
                    { label: "Records Uploaded", pct: 42 },
                  ].map((p) => (
                    <div key={p.label}>
                      <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                        <span>{p.label}</span>
                        <span className="font-medium text-[#4B90FF]">{p.pct}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#4B90FF] rounded-full" style={{ width: `${p.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6">
                  <SubHeader title="Pagination" />
                  <div className="flex items-center gap-1">
                    <button className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF]">Previous</button>
                    {[1, 2, 3].map((n) => (
                      <button key={n} className={`w-8 h-8 text-xs rounded-md font-medium ${n === 1 ? "bg-[#4B90FF] text-white" : "text-gray-500 border border-gray-200 hover:border-[#4B90FF]"}`}>{n}</button>
                    ))}
                    <button className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF]">Next</button>
                  </div>
                </div>
              </div>

              <div>
                <SubHeader title="Accordion FAQ" />
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  {[
                    { id: "q1", q: "How do I schedule a new appointment?", a: "Navigate to the Appointments tab, click 'New Appointment', select the patient and provider, then choose an available time slot." },
                    { id: "q2", q: "How do I transfer patient records?", a: "Go to the patient's profile and click 'Transfer Records'. You'll need authorization from the receiving provider." },
                    { id: "q3", q: "What insurance plans are supported?", a: "Careexpand supports all major insurance plans including Blue Cross PPO, Aetna, UnitedHealth, Cigna, Medicare, and Humana." },
                  ].map((item, i) => (
                    <div key={item.id} className={i > 0 ? "border-t border-gray-100" : ""}>
                      <button
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                        onClick={() => setAccordionOpen(accordionOpen === item.id ? null : item.id)}
                      >
                        <span className="text-sm font-medium text-[#4B90FF]">{item.q}</span>
                        {accordionOpen === item.id ? <ChevronUp size={14} className="text-gray-400 shrink-0" /> : <ChevronDown size={14} className="text-gray-400 shrink-0" />}
                      </button>
                      {accordionOpen === item.id && (
                        <div className="px-4 pb-3">
                          <p className="text-xs text-gray-500 leading-[1.2]">{item.a}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════ DATA TABLES */}
          <section id="tables" className="scroll-mt-20 pb-12">
            <SectionHeader id="tables" label="Data" title="Data Tables — Appointments" desc="Appointments data table with status badges, action icons, and patient information. Includes header search, column sorting, and pagination." />

            <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">Citas</span>
                <span className="w-5 h-5 rounded-full bg-[#4B90FF] text-white text-[10px] font-bold flex items-center justify-center">2</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {["Tiempo", "Paciente", "Tipo de cita", "Ubicación", "Pre-Visita", "Estado", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { time: "Feb 19 11:30 AM", name: "Alderwick Rowan", dob: "12/31/1979 (46y)", type: "First Consultation", loc: "Teleconsultation", previsit: "Cerrado", estado: "Pendiente", id: 0 },
                    { time: "Feb 19 1:20 PM", name: "Isabelo Moreno", dob: "10/09/1980 (45y)", type: "Follow-up Consultation", loc: "Teleconsultation", previsit: "Cerrado", estado: "Pendiente", id: 1 },
                  ].map((row) => (
                    <>
                      <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer" onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)}>
                        <td className="px-4 py-3 text-xs text-[#4B90FF] font-medium whitespace-nowrap">{row.time}</td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-semibold text-gray-700">{row.name}</p>
                          <p className="text-[11px] text-gray-400 ce-mono">{row.dob}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#4B90FF]">{row.type}</td>
                        <td className="px-4 py-3 text-xs text-[#4B90FF]">{row.loc}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-[#404040] text-white text-[10px] font-medium rounded-full">{row.previsit}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#EAB508] font-medium">{row.estado}</td>
                        <td className="px-4 py-3">
                          <Download size={14} className="text-[#4B90FF]" />
                        </td>
                      </tr>
                      {expandedRow === row.id && (
                        <tr key={`${row.id}-expanded`} className="bg-gray-50/50">
                          <td colSpan={7} className="px-5 py-4">
                            <div className="mb-3">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm font-semibold text-gray-700">Notas</span>
                                <button className="text-gray-400 hover:text-[#4B90FF]">✏️</button>
                              </div>
                              <div className="bg-white border border-gray-100 rounded-md px-4 py-3">
                                <p className="text-xs text-gray-400">No hay notas para este paciente</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {[
                                { icon: <CreditCard size={12} />, label: "Facturación" },
                                { icon: <FileBarChart size={12} />, label: "Resumen" },
                                { icon: <Phone size={12} />, label: "Llamar al Paciente" },
                                { icon: <MessageSquare size={12} />, label: "Mensajes" },
                                { icon: <Video size={12} />, label: "Ir al Encuentro" },
                              ].map((b) => (
                                <button key={b.label} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors">
                                  {b.icon} {b.label}
                                </button>
                              ))}
                              <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md">
                                <PlayCircle size={12} /> Iniciar Encuentro
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <SectionDivider />

          {/* ══════════════════════════════════════════ ADVANCED TABLES */}
          <section id="advanced" className="scroll-mt-20 pb-12">
            <SectionHeader id="advanced" label="Data" title="Advanced Tables & UI" desc="Superbills, payments, patient balances, statements, notifications, and profile components for the Careexpand healthcare platform." />

            {/* Payments */}
            <SubHeader title="Payments — Incoming ERAs" />
            <div className="bg-white border border-gray-100 rounded-lg overflow-hidden mb-8">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <CreditCard size={15} className="text-[#4B90FF]" />
                <span className="text-sm font-semibold text-gray-800">Payments</span>
              </div>
              <div className="grid grid-cols-4 gap-0 border-b border-gray-100">
                {[
                  { label: "TOTAL PAYMENTS", val: "6" },
                  { label: "TOTAL PAID", val: "$23,800.00", accent: true },
                  { label: "TOTAL BILLED", val: "$28,600.00", accent: true },
                  { label: "CLAIMS COUNT", val: "24" },
                ].map((s, i) => (
                  <div key={s.label} className={`px-5 py-4 ${i < 3 ? "border-r border-gray-100" : ""}`}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{s.label}</p>
                    <p className={`text-xl font-bold ${s.accent ? "text-[#4B90FF]" : "text-gray-800"}`}>{s.val}</p>
                  </div>
                ))}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {["PAYER", "PAYMENT DATE", "TOTAL PAID", "CLAIMS", "STATUS", "ACTIONS"].map((h) => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { payer: "BlueCross", date: "05/20/2024", paid: "$9,000.00", claims: 5, status: "New", statusColor: "#4B90FF" },
                    { payer: "Aetna", date: "05/18/2024", paid: "$3,500.00", claims: 3, status: "Posted", statusColor: "#56A34A" },
                    { payer: "UnitedHealth", date: "05/18/2024", paid: "$4,200.00", claims: 6, status: "Needs Review", statusColor: "#EAB508" },
                    { payer: "Cigna", date: "05/17/2024", paid: "$2,800.00", claims: 2, status: "Review", statusColor: "#EAB508" },
                    { payer: "Medicare", date: "05/16/2024", paid: "$8,500.00", claims: 8, status: "New", statusColor: "#4B90FF" },
                  ].map((row) => (
                    <tr key={row.payer} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-700">— {row.payer}</td>
                      <td className="px-4 py-3 text-gray-500">{row.date}</td>
                      <td className="px-4 py-3 font-semibold text-gray-700">{row.paid}</td>
                      <td className="px-4 py-3 text-gray-500">{row.claims}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium" style={{ color: row.statusColor }}>{row.status}</span>
                      </td>
                      <td className="px-4 py-3 text-[#4B90FF] hover:underline cursor-pointer">View Details</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">Page 1 of 1</span>
                <div className="flex gap-1">
                  <button className="px-3 py-1 text-xs text-gray-500 border border-gray-200 rounded">Previous</button>
                  <button className="w-7 h-7 text-xs bg-[#4B90FF] text-white rounded font-medium">1</button>
                  <button className="px-3 py-1 text-xs text-gray-500 border border-gray-200 rounded">Next</button>
                </div>
              </div>
            </div>

            {/* Patient Balances */}
            <SubHeader title="Patient Balances" />
            <div className="bg-white border border-gray-100 rounded-lg overflow-hidden mb-8">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <Users size={15} className="text-[#4B90FF]" />
                <span className="text-sm font-semibold text-gray-800">Patient Balances</span>
              </div>
              <div className="grid grid-cols-4 gap-0 border-b border-gray-100">
                {[
                  { label: "TOTAL INCOMING", val: "$8,933.00", sub: "% patients" },
                  { label: "ACTIVE BALANCE", val: "6", sub: "Current accounts" },
                  { label: "IN COLLECTION", val: "1", sub: "Requires attention", warn: true },
                  { label: "AGING BREAKDOWN", val: "$3,131.50 / $5,801.50", sub: "Current / Total" },
                ].map((s, i) => (
                  <div key={s.label} className={`px-4 py-4 ${i < 3 ? "border-r border-gray-100" : ""}`}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{s.label}</p>
                    <p className={`text-base font-bold ${s.warn ? "text-[#FF4D4D]" : "text-[#4B90FF]"}`}>{s.val}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{s.sub}</p>
                  </div>
                ))}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {["PATIENT", "TOTAL BALANCE", "AGING BREAKDOWN", "STATUS", "LAST STATEMENT", "ACTIONS"].map((h) => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Robert Johnson", bal: "$2,100.00", aging: [60, 25, 15], status: "Sent To Collection", statusColor: "#FF4D4D", stmt: "11/25/2025" },
                    { name: "David Lee", bal: "$1,005.00", aging: [70, 20, 10], status: "Active", statusColor: "#56A34A", stmt: "2/15/2026" },
                    { name: "Maria Garcia", bal: "$480.00", aging: [100, 0, 0], status: "Payment Plan", statusColor: "#4B90FF", stmt: "2/19/2026" },
                    { name: "Michael Brown", bal: "$0.00", aging: [0, 0, 0], status: "Closed", statusColor: "#727273", stmt: "1/24/2026" },
                  ].map((row) => (
                    <tr key={row.name} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-700">{row.name}</p>
                        <p className="text-[10px] text-gray-400">PT-1</p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-700">{row.bal}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-0.5 h-3">
                          <div className="h-full rounded-sm bg-[#FF4D4D]" style={{ width: `${row.aging[0] * 0.5}px` }} />
                          <div className="h-full rounded-sm bg-[#EAB508]" style={{ width: `${row.aging[1] * 0.5}px` }} />
                          <div className="h-full rounded-sm bg-[#56A34A]" style={{ width: `${row.aging[2] * 0.5}px` }} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium" style={{ color: row.statusColor }}>{row.status}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{row.stmt}</td>
                      <td className="px-4 py-3">
                        <Download size={13} className="text-[#4B90FF]" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Statements */}
            <SubHeader title="Patient Statements" />
            <div className="bg-white border border-gray-100 rounded-lg overflow-hidden mb-8">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-[#4B90FF]" />
                  <span className="text-sm font-semibold text-gray-800">Patient Statements</span>
                  <span className="w-5 h-5 rounded-full bg-[#4B90FF] text-white text-[10px] font-bold flex items-center justify-center">3</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="text" placeholder="Search patient name..." className="border border-gray-200 rounded-md px-3 py-1.5 text-xs text-gray-600 placeholder-gray-300 focus:outline-none focus:border-[#4B90FF]" />
                  <select className="border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-500 focus:outline-none focus:border-[#4B90FF]">
                    <option>All Statuses</option>
                    <option>Paid</option>
                    <option>Pending</option>
                    <option>Overdue</option>
                  </select>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {["STATEMENT #", "PATIENT", "AMOUNT DUE", "STATUS", "DELIVERY", "CREATED", "DUE DATE", "ACTIONS"].map((h) => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { stmt: "STMT-2024-002", patient: "Emily Davis", amount: "$325.00", status: "Paid", statusColor: "#56A34A", delivery: "PORTAL", created: "3/18/2024", due: "3/02/2026" },
                    { stmt: "STMT-2024-001", patient: "Sarah Johnson", amount: "$850.00", status: "Overdue", statusColor: "#FF4D4D", delivery: "PORTAL", created: "2/28/2026", due: "3/02/2026" },
                    { stmt: "STMT-2024-002", patient: "Michael Brown", amount: "$1,260.00", status: "Sent", statusColor: "#4B90FF", delivery: "EMAIL", created: "1/3/2024", due: "3/02/2026" },
                  ].map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 ce-mono text-gray-600">{row.stmt}</td>
                      <td className="px-4 py-3 font-medium text-gray-700">{row.patient}</td>
                      <td className="px-4 py-3 font-semibold text-gray-700">{row.amount}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ color: row.statusColor, background: `${row.statusColor}18` }}>{row.status}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{row.delivery}</td>
                      <td className="px-4 py-3 text-gray-500">{row.created}</td>
                      <td className="px-4 py-3 text-gray-500">{row.due}</td>
                      <td className="px-4 py-3">
                        <Download size={13} className="text-[#4B90FF]" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Notifications */}
            <SubHeader title="Notifications & Profile" />
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell size={14} className="text-[#4B90FF]" />
                    <span className="text-sm font-semibold text-gray-800">Notifications</span>
                    <span className="w-4 h-4 rounded-full bg-[#4B90FF] text-white text-[9px] font-bold flex items-center justify-center">3</span>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span>Only unread</span>
                    <div className="w-7 h-4 rounded-full bg-[#4B90FF] relative">
                      <div className="absolute top-0.5 right-0.5 w-3 h-3 bg-white rounded-full" />
                    </div>
                  </label>
                </div>
                <div className="divide-y divide-gray-50">
                  {[
                    { icon: "💬", title: "New message Received", sub: "Philip Bacon · Feb 19, 2026 · 04:51", isNew: true },
                    { icon: "💬", title: "New message Received", sub: "Philip Bacon · Feb 19, 2026 · 04:51", isNew: false },
                    { icon: "📋", title: "New order created", sub: "The new order for patient Alderwick Rowan was created. · Feb 19, 2026 · 04:51", isNew: false },
                  ].map((n, i) => (
                    <div key={i} className={`px-4 py-3 ${n.isNew ? "bg-blue-50/50" : ""}`}>
                      <div className="flex items-start gap-2 mb-2">
                        <span className="text-sm">{n.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-700">{n.title}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5 leading-[1.2]">{n.sub}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 ml-6">
                        <button className="px-2 py-1 text-[10px] text-[#4B90FF] border border-[#4B90FF]/30 rounded">Dismiss</button>
                        <button className="px-2 py-1 text-[10px] text-white bg-[#4B90FF] rounded">Reply</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-gray-100 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-100">
                  <div className="w-10 h-10 rounded-full bg-blue-100 text-[#4B90FF] font-bold text-sm flex items-center justify-center">JV</div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Jaume Vinals</p>
                    <p className="text-xs text-gray-400">jaume@acmecorp.com</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {[
                    { icon: "👤", label: "Configuración de perfil" },
                    { icon: "⚙️", label: "Settings" },
                    { icon: "🌐", label: "Global sidebar" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer">
                      <span className="text-sm">{item.icon}</span>
                      <span className="text-xs text-gray-600">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════════ AUTH FORMS */}
          <section id="auth" className="scroll-mt-20 pb-12">
            <SectionHeader id="auth" label="Data" title="Authentication Forms" desc="Sign in and sign up forms with validation states, input fields, and call-to-action buttons for the Careexpand platform." />

            <div className="grid grid-cols-2 gap-6">
              {/* Sign In */}
              <div className="bg-white border border-gray-100 rounded-lg p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-1">Sign in to Careexpand</h3>
                <p className="text-xs text-[#4B90FF] mb-5">Don't have an account? <a href="#" className="underline">Create one for free here</a></p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Email address</label>
                    <div className="relative">
                      <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                      <input type="email" placeholder="E-mail address" className="w-full border border-[#FF4D4D] rounded-md pl-9 pr-3 py-2 text-sm placeholder-gray-300 focus:outline-none" />
                    </div>
                    <p className="text-xs text-[#FF4D4D] mt-1">Please enter a valid email address</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Password</label>
                    <div className="relative">
                      <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                      <input type="password" placeholder="Password" className="w-full border border-gray-200 rounded-md pl-9 pr-3 py-2 text-sm placeholder-gray-300 focus:outline-none focus:border-[#4B90FF]" />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Forgot your password?</p>
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <a href="#" className="text-sm text-[#4B90FF]">I'm a patient</a>
                    <button className="px-6 py-2 bg-[#4B90FF] text-white text-sm font-medium rounded-md hover:bg-blue-500 transition-colors">Login</button>
                  </div>
                </div>
              </div>

              {/* Sign Up */}
              <div className="bg-white border border-gray-100 rounded-lg p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-1">Create your account</h3>
                <p className="text-xs text-[#4B90FF] mb-5">Already have an account? <a href="#" className="underline">Sign in here</a></p>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">First name</label>
                      <input type="text" placeholder="First name" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm placeholder-gray-300 focus:outline-none focus:border-[#4B90FF]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Last name</label>
                      <input type="text" placeholder="Last name" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm placeholder-gray-300 focus:outline-none focus:border-[#4B90FF]" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Email address</label>
                    <input type="email" placeholder="you@example.com" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm placeholder-gray-300 focus:outline-none focus:border-[#4B90FF]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Password</label>
                    <input type="password" placeholder="Create a strong password" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm placeholder-gray-300 focus:outline-none focus:border-[#4B90FF]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Confirm password</label>
                    <input type="password" placeholder="Repeat your password" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm placeholder-gray-300 focus:outline-none focus:border-[#4B90FF]" />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className="w-4 h-4 rounded border-2 border-gray-300 bg-white shrink-0" />
                    <span className="text-xs text-gray-500">I agree to the <a href="#" className="text-[#4B90FF] underline">Terms of Service and Privacy Policy</a></span>
                  </label>
                  <button className="w-full py-2.5 bg-[#4B90FF] text-white text-sm font-medium rounded-md hover:bg-blue-500 transition-colors">Create Account</button>
                  <div className="text-center">
                    <p className="text-xs text-gray-400 mb-2">or continue with</p>
                    <div className="flex gap-2 justify-center">
                      <button className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-md text-xs text-gray-600 hover:border-[#4B90FF] transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                        Google
                      </button>
                      <button className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-md text-xs text-gray-600 hover:border-[#4B90FF] transition-colors">
                        <svg width="14" height="14" viewBox="0 0 23 23"><path fill="#f3f3f3" d="M0 0h23v23H0z"/><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>
                        Microsoft
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════ EMAIL SIGNATURE */}
          <section id="email-signature" className="scroll-mt-20 pb-12">
            <SectionHeader id="email-signature" label="Data" title="Email Signature" desc="Professional email signature for Careexpand team members. Uses brand logo, Inter typography, and contact detail icons. Copy for use in email clients." />

            <SubHeader title="Careexpand Email Signature" />
            <div className="bg-white border border-gray-100 rounded-lg p-6">
              <div className="border-b border-gray-100 pb-4 mb-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-3">Preview</p>
                <div className="inline-block rounded-lg py-6 px-7 bg-white border border-[#E5E5E5] w-[560px]">
                  <div className="flex items-center gap-5 mb-2">
                    <img src="/style-guide/careexpand_logo_exact.svg" alt="Careexpand" className="w-[31px] h-[31px] shrink-0 object-contain" />
                    <div className="flex flex-col gap-0.5">
                      <p className="text-[18px] font-bold leading-[1.2] tracking-[-0.3px]" style={{ color: "#0a0a0a" }}>John Doecex</p>
                      <p className="text-[13px] font-medium leading-[1.2]" style={{ color: "#489DFF" }}>Backend Engineer</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Phone size={14} style={{ color: "#489DFF" }} />
                      <span className="text-[13px] font-normal leading-[1.2]" style={{ color: "#737373" }}>(469) 213-5555</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail size={14} style={{ color: "#489DFF" }} />
                      <span className="text-[13px] font-normal leading-[1.2]" style={{ color: "#737373" }}>john@careexpand.com</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Globe size={14} style={{ color: "#489DFF" }} />
                      <a href="https://www.careexpand.com" className="text-[13px] font-medium leading-[1.2] hover:underline" style={{ color: "#489DFF" }}>www.careexpand.com</a>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin size={14} style={{ color: "#489DFF" }} />
                      <span className="text-[13px] font-normal leading-[1.2]" style={{ color: "#737373" }}>5830 Granite Parkway STE 100-296, Plano TX 75024</span>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-3 mt-6">Signature-small</p>
                <div className="inline-block rounded-md py-4 px-5 bg-white border border-[#E5E5E5] w-[380px]">
                  <div className="flex items-center gap-3 mb-1.5">
                    <img src="/style-guide/careexpand_logo_exact.svg" alt="Careexpand" className="w-6 h-6 shrink-0 object-contain" />
                    <div className="flex flex-col gap-0.5">
                      <p className="text-[14px] font-bold leading-[1.2] tracking-[-0.2px]" style={{ color: "#0a0a0a" }}>John Doecex</p>
                      <p className="text-[11px] font-medium leading-[1.2]" style={{ color: "#489DFF" }}>Backend Engineer</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <Phone size={12} style={{ color: "#489DFF" }} />
                      <span className="text-[11px] font-normal leading-[1.2]" style={{ color: "#737373" }}>(469) 213-5555</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Mail size={12} style={{ color: "#489DFF" }} />
                      <span className="text-[11px] font-normal leading-[1.2]" style={{ color: "#737373" }}>john@careexpand.com</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Globe size={12} style={{ color: "#489DFF" }} />
                      <a href="https://www.careexpand.com" className="text-[11px] font-medium leading-[1.2] hover:underline" style={{ color: "#489DFF" }}>www.careexpand.com</a>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin size={12} style={{ color: "#489DFF" }} />
                      <span className="text-[11px] font-normal leading-[1.2]" style={{ color: "#737373" }}>5830 Granite Parkway STE 100-296, Plano TX 75024</span>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Usage</p>
                <p className="text-xs text-gray-500 leading-[1.2] mb-3">
                  Copy this block into your email client signature settings. Replace name, title, and contact details with your own.
                </p>
                <p className="text-xs text-gray-500 leading-[1.2]">
                  The signature uses Inter for all text. The name is 18px bold (#0a0a0a) with -0.3px letter spacing; the title and contact links are 13px medium (#489DFF); contact text and address are 13px regular (#737373); icons use #489DFF. Line height is 1.2 throughout. Spacing: 20px between logo and name block, 2px between name and title, 8px between top row and contact section, 4px between contact rows, and 8px between icon and text in each row. The container has 24px vertical and 28px horizontal padding, a 1px solid #E5E5E5 border, 8px corner radius, and 560px width.
                </p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2 mt-4">HTML Copy</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(EMAIL_SIG_HTML);
                      setEmailSigCopied(true);
                      setTimeout(() => setEmailSigCopied(false), 2000);
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#4B90FF] text-white hover:bg-blue-600 transition-colors"
                  >
                    {emailSigCopied ? "Copied!" : "Copy html"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(EMAIL_SIG_HTML_SMALL);
                      setEmailSigSmallCopied(true);
                      setTimeout(() => setEmailSigSmallCopied(false), 2000);
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-600 hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors"
                  >
                    {emailSigSmallCopied ? "Copied!" : "Copy html (small)"}
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">Paste into your email client signature settings. Replace name, title, and contact details with your own. Logo URL may need to be updated if hosted elsewhere.</p>
              </div>
            </div>
          </section>

          <SectionDivider />

          {/* ════════════════════════════════════════════ DESIGN PRINCIPLES */}
          <section id="principles" className="scroll-mt-20 pb-12">
            <SectionHeader id="principles" label="Principles" title="Design Principles" desc="Four guiding principles that define the Careexpand design system — from visual philosophy to accessibility standards." />

            <div className="grid grid-cols-4 gap-4">
              {[
                {
                  icon: <div className="flex gap-1"><div className="w-6 h-6 bg-gray-900 rounded-sm" /><div className="w-6 h-6 bg-gray-200 rounded-sm" /><div className="w-6 h-6 bg-gray-100 rounded-sm border border-gray-200" /></div>,
                  title: "Clean Minimalism",
                  color: "#4B90FF",
                  desc: "High contrast black and white foundation. Every element earns its place. Generous whitespace lets content breathe.",
                },
                {
                  icon: <div className="space-y-1"><div className="h-1.5 bg-[#4B90FF] rounded-full w-full" /><div className="h-1.5 bg-[#4B90FF] rounded-full w-3/4" /><div className="h-1.5 bg-[#4B90FF] rounded-full w-1/2" /></div>,
                  title: "Professional Trust",
                  color: "#4B90FF",
                  desc: "Healthcare demands reliability. Restrained color, precise spacing, and systematic typography build confidence.",
                },
                {
                  icon: <div className="flex items-center gap-2"><div className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center text-[#4B90FF] text-xs font-bold">AA</div><span className="text-xs text-[#56A34A] font-semibold">WCAG 2.1</span></div>,
                  title: "Accessibility First",
                  color: "#4B90FF",
                  desc: "Clear focus states, sufficient contrast ratios, and readable type sizes. The blue accent (#4B90FF) meets WCAG AA standards.",
                },
                {
                  icon: <div className="space-y-1"><code className="text-[10px] text-[#4B90FF] ce-mono">--color-primary</code><br /><code className="text-[10px] text-[#4B90FF] ce-mono">--space-medium</code><br /><code className="text-[10px] text-[#4B90FF] ce-mono">--radius-base</code></div>,
                  title: "Systematic Consistency",
                  color: "#4B90FF",
                  desc: "Tokens over hardcoded values. Components over custom layouts. A design system that scales with your product.",
                },
              ].map((p) => (
                <div key={p.title} className="bg-white border border-gray-100 rounded-lg p-5">
                  <div className="mb-4 h-10 flex items-center">{p.icon}</div>
                  <p className="text-sm font-semibold mb-2" style={{ color: p.color }}>{p.title}</p>
                  <p className="text-xs text-gray-500 leading-[1.2]">{p.desc}</p>
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* Footer */}
        <footer className="border-t border-gray-100 px-10 py-6 flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-[#4B90FF]">Careexpand</span>
            <p className="text-xs text-gray-400 mt-0.5">The operating system for continuity of care</p>
          </div>
          <p className="text-xs text-gray-400">Style Guide v1.0 — 2026</p>
        </footer>
      </main>
    </div>
  );
}
