import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AutoClerkOtpUiMode, EvaluationRow } from '@/lib/api';
import {
  buildClientNavigationDetail,
  getAllNavigationRows,
  registerClientNavigation,
} from '@/pages/navigation/mockNavigations';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Navigation as NavigationIcon, Plus, ExternalLink } from 'lucide-react';

export default function NavigationsPage() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [intent, setIntent] = useState('');
  const [desiredOutput, setDesiredOutput] = useState('');
  const [autoSignIn, setAutoSignIn] = useState(false);
  const [autoSignInOtp, setAutoSignInOtp] = useState<AutoClerkOtpUiMode>('default');
  /** Bumps when client-only rows are added so the list re-renders. */
  const [listEpoch, setListEpoch] = useState(0);

  const rows = useMemo(() => {
    void listEpoch;
    return getAllNavigationRows();
  }, [listEpoch]);

  const submit = () => {
    const u = url.trim();
    if (!u || !intent.trim() || !desiredOutput.trim()) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const row: EvaluationRow = {
      id,
      name: name.trim() || 'Untitled navigation',
      url: u,
      projectId: null,
      project: null,
      autoSignIn,
      autoSignInClerkOtpMode:
        autoSignIn && autoSignInOtp !== 'default' ? autoSignInOtp : null,
      runMode: 'continuous',
      status: 'QUEUED',
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    const detail = buildClientNavigationDetail(row, intent.trim(), desiredOutput.trim());
    registerClientNavigation(row, detail);
    setName('');
    setUrl('https://');
    setIntent('');
    setDesiredOutput('');
    setAutoSignIn(false);
    setAutoSignInOtp('default');
    setPanelOpen(false);
    setListEpoch((e) => e + 1);
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight flex items-center gap-2">
            <NavigationIcon className="w-7 h-7 text-[#4B90FF]" />
            Navigations
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            Plan and review app navigation flows. This area mirrors Evaluations; backend wiring comes later—use it to
            iterate on the UI and behavior step by step.
          </p>
        </div>
        <button
          type="button"
          aria-label="New navigation"
          onClick={() => setPanelOpen((o) => !o)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#4B90FF] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#3d7fe6] sm:px-4"
        >
          <span className="text-xl font-medium leading-none sm:hidden">+</span>
          <span className="hidden items-center gap-2 sm:inline-flex">
            <Plus size={18} className="shrink-0" aria-hidden />
            New navigation
          </span>
        </button>
      </div>

      {panelOpen && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Create navigation</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-gray-500">Name (optional)</span>
              <input
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Primary IA review"
              />
            </label>
            <div className="block sm:col-span-2 rounded-md border border-gray-100 bg-gray-50/80 px-3 py-3 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-gray-300"
                  checked={autoSignIn}
                  onChange={(e) => setAutoSignIn(e.target.checked)}
                />
                <span className="text-sm text-gray-800">
                  Auto-sign in when the app shows a sign-in screen (not wired yet—saved for later).
                </span>
              </label>
              {autoSignIn && (
                <div className="pl-6 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                  <label htmlFor="nav-create-clerk-otp" className="whitespace-nowrap">
                    Clerk OTP
                  </label>
                  <select
                    id="nav-create-clerk-otp"
                    value={autoSignInOtp}
                    onChange={(e) => setAutoSignInOtp(e.target.value as AutoClerkOtpUiMode)}
                    className="flex-1 min-w-[160px] border border-gray-200 rounded-md px-2 py-1.5 text-[11px] text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                  >
                    <option value="default">Server default</option>
                    <option value="clerk_test_email">Test email (424242)</option>
                    <option value="mailslurp">MailSlurp inbox</option>
                  </select>
                </div>
              )}
            </div>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-gray-500">Start URL</span>
              <input
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-mono"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-gray-500">Global intent</span>
              <textarea
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm min-h-[88px]"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="What should this navigation capture or verify?"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-gray-500">Desired report output</span>
              <textarea
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm min-h-[88px]"
                value={desiredOutput}
                onChange={(e) => setDesiredOutput(e.target.value)}
                placeholder="e.g. Site map, route list, coverage notes..."
              />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="text-sm text-gray-600 px-3 py-2"
              onClick={() => setPanelOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded-lg bg-[#4B90FF] text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-12 text-center border border-dashed border-gray-200 rounded-xl">
          No navigations yet. Create one to get started (stored locally until the API is connected).
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white overflow-hidden">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                to={`/navigations/${row.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50/80 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 truncate">{row.name}</span>
                    <StatusBadge status={row.status} size="sm" narrowAsIcon />
                    {row.project && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] text-gray-500 max-w-[140px] truncate"
                        title={row.project.name}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: row.project.color }}
                          aria-hidden
                        />
                        {row.project.name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5 flex items-center gap-1">
                    <ExternalLink size={12} className="shrink-0 opacity-60" />
                    {row.url}
                  </p>
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {new Date(row.createdAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
