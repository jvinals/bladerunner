import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evaluationsApi } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useEvaluationLive } from '@/hooks/useEvaluationLive';
import {
  ArrowLeft,
  Play,
  Square,
  ClipboardList,
  ExternalLink,
  Loader2,
  Radio,
} from 'lucide-react';

function parseOptions(q: { optionsJson: string }): string[] {
  try {
    const parsed = JSON.parse(q.optionsJson) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export default function EvaluationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [humanSelection, setHumanSelection] = useState<Record<string, number>>({});

  const query = useQuery({
    queryKey: ['evaluation', id],
    queryFn: () => evaluationsApi.get(id!),
    enabled: !!id,
  });

  const ev = query.data;
  const liveEnabled =
    !!id && !!ev && (ev.status === 'RUNNING' || ev.status === 'WAITING_FOR_HUMAN');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['evaluation', id] });
    void queryClient.invalidateQueries({ queryKey: ['evaluations'] });
  };

  const { frameDataUrl, lastProgress, connected } = useEvaluationLive(id, {
    enabled: liveEnabled,
    onStale: invalidate,
  });

  const startMutation = useMutation({
    mutationFn: () => evaluationsApi.start(id!),
    onSuccess: invalidate,
  });

  const cancelMutation = useMutation({
    mutationFn: () => evaluationsApi.cancel(id!),
    onSuccess: invalidate,
  });

  const humanMutation = useMutation({
    mutationFn: (body: { questionId: string; selectedIndex: number }) =>
      evaluationsApi.humanAnswer(id!, body),
    onSuccess: invalidate,
  });

  const pendingQuestion = useMemo(() => {
    if (!ev?.questions?.length) return null;
    return ev.questions.find((q) => q.state === 'pending') ?? null;
  }, [ev]);

  const latestReport = ev?.reports?.[0] ?? null;

  if (!id) {
    return <ErrorState message="Missing evaluation id" />;
  }
  if (query.isLoading) return <LoadingState message="Loading evaluation..." />;
  if (query.error || !ev) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <ErrorState message="Evaluation not found or failed to load." />
        <Link to="/evaluations" className="text-sm text-[#4B90FF] mt-4 inline-block">
          ← Back to evaluations
        </Link>
      </div>
    );
  }

  const canStart = ev.status === 'QUEUED' || ev.status === 'FAILED';
  const canCancel = ev.status === 'RUNNING' || ev.status === 'QUEUED' || ev.status === 'WAITING_FOR_HUMAN';
  const showHuman =
    ev.status === 'WAITING_FOR_HUMAN' && pendingQuestion && parseOptions(pendingQuestion).length > 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-6">
        <Link
          to="/evaluations"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft size={16} />
          Evaluations
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-start gap-8">
        <div className="flex-1 min-w-0 space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-semibold text-gray-900 tracking-tight flex items-center gap-2">
                <ClipboardList className="w-7 h-7 text-[#4B90FF]" />
                {ev.name}
              </h1>
              <StatusBadge status={ev.status} />
            </div>
            <a
              href={ev.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-[#4B90FF] inline-flex items-center gap-1 hover:underline"
            >
              <ExternalLink size={14} />
              {ev.url}
            </a>
            {ev.failureMessage && (
              <p className="mt-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{ev.failureMessage}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {canStart && (
              <button
                type="button"
                disabled={startMutation.isPending}
                onClick={() => startMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#4B90FF] text-white text-sm font-medium px-4 py-2 hover:bg-[#3d7fe6] disabled:opacity-50"
              >
                {startMutation.isPending ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                {ev.status === 'FAILED' ? 'Retry run' : 'Start run'}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
              >
                <Square size={16} />
                Cancel
              </button>
            )}
            {ev.status === 'RUNNING' && (
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                <Radio size={14} className={connected ? 'text-green-500' : 'text-amber-500'} />
                {connected ? 'Live stream connected' : 'Connecting…'}
              </span>
            )}
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-800 mb-2">Intent</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{ev.intent}</p>
            <h2 className="text-sm font-semibold text-gray-800 mt-4 mb-2">Desired output</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{ev.desiredOutput}</p>
          </section>

          {showHuman && pendingQuestion && (
            <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
              <h2 className="text-sm font-semibold text-violet-900 mb-2">Your input</h2>
              <p className="text-sm text-gray-800 mb-3">{pendingQuestion.prompt}</p>
              <div className="space-y-2">
                {parseOptions(pendingQuestion).map((opt, idx) => (
                  <label
                    key={idx}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="human-q"
                      checked={(humanSelection[pendingQuestion.id] ?? -1) === idx}
                      onChange={() =>
                        setHumanSelection((s) => ({ ...s, [pendingQuestion.id]: idx }))
                      }
                    />
                    {opt}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="mt-4 rounded-lg bg-violet-600 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
                disabled={
                  humanMutation.isPending ||
                  typeof humanSelection[pendingQuestion.id] !== 'number'
                }
                onClick={() => {
                  const sel = humanSelection[pendingQuestion.id];
                  if (typeof sel !== 'number') return;
                  humanMutation.mutate({ questionId: pendingQuestion.id, selectedIndex: sel });
                }}
              >
                {humanMutation.isPending ? 'Submitting…' : 'Submit answer'}
              </button>
            </section>
          )}

          {lastProgress && lastProgress.phase && (
            <section className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 text-xs font-mono text-gray-700 overflow-x-auto">
              <span className="text-gray-500">Last event · {lastProgress.phase}</span>
              <pre className="mt-2 whitespace-pre-wrap break-words">
                {JSON.stringify(lastProgress, null, 2)}
              </pre>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Steps</h2>
            {ev.steps.length === 0 ? (
              <p className="text-sm text-gray-500">No steps yet.</p>
            ) : (
              <ol className="space-y-3">
                {ev.steps.map((st) => (
                  <li
                    key={st.id}
                    className="rounded-lg border border-gray-200 bg-white p-3 text-sm"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900">Step {st.sequence}</span>
                      {st.decision && (
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">
                          {st.decision}
                        </span>
                      )}
                    </div>
                    {st.thinkingText && (
                      <p className="text-gray-600 text-xs whitespace-pre-wrap mb-2">{st.thinkingText}</p>
                    )}
                    {st.proposedCode && (
                      <pre className="text-[11px] bg-gray-900 text-gray-100 rounded-md p-2 overflow-x-auto max-h-40">
                        {st.proposedCode}
                      </pre>
                    )}
                    {st.analyzerRationale && (
                      <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{st.analyzerRationale}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {latestReport && (
            <section>
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Report</h2>
              <div className="rounded-xl border border-gray-200 bg-white p-4 prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">{latestReport.content}</pre>
              </div>
            </section>
          )}

          {ev.progressSummary && (
            <section>
              <h2 className="text-sm font-semibold text-gray-800 mb-2">Progress log</h2>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100 max-h-48 overflow-y-auto">
                {ev.progressSummary}
              </pre>
            </section>
          )}
        </div>

        <div className="w-full lg:w-[420px] shrink-0">
          <div className="sticky top-6 rounded-xl border border-gray-200 bg-black overflow-hidden aspect-video flex items-center justify-center">
            {frameDataUrl ? (
              <img src={frameDataUrl} alt="Live browser" className="w-full h-full object-contain" />
            ) : (
              <span className="text-gray-500 text-sm px-4 text-center">
                {ev.status === 'RUNNING'
                  ? 'Waiting for video frame…'
                  : ev.status === 'COMPLETED'
                    ? 'Run finished'
                    : 'Start the run to see the browser'}
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-400 mt-2 text-center">
            Remote browser · same worker as recording
          </p>
        </div>
      </div>
    </div>
  );
}
