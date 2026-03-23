import { useState, useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { runsApi } from '@/lib/api';
import type { SkipReplaySuggestionItem } from '@/components/ui/SkipReplaySuggestionsModal';

export function useSkipReplayAfterStepChange(options: {
  runId: string | null | undefined;
  queryClient: QueryClient;
}) {
  const [open, setOpen] = useState(false);
  const [anchorStepId, setAnchorStepId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SkipReplaySuggestionItem[]>([]);
  const [busy, setBusy] = useState(false);

  const promptAfterStepChange = useCallback(
    async (anchor: string) => {
      const rid = options.runId;
      if (!rid || !anchor) return;
      try {
        const res = await runsApi.suggestSkipAfterChange(rid, { anchorStepId: anchor });
        const list = res.suggestions ?? [];
        if (list.length === 0) return;
        setAnchorStepId(anchor);
        setSuggestions(list);
        setOpen(true);
      } catch (e) {
        console.error('suggestSkipAfterChange failed', e);
      }
    },
    [options.runId],
  );

  const dismiss = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setSuggestions([]);
    setAnchorStepId(null);
  }, [busy]);

  const confirm = useCallback(async () => {
    const rid = options.runId;
    if (!rid || !anchorStepId || suggestions.length === 0) return;
    setBusy(true);
    try {
      await runsApi.bulkSkipReplay(rid, {
        anchorStepId,
        stepIds: suggestions.map((s) => s.stepId),
      });
      await options.queryClient.invalidateQueries({ queryKey: ['run-steps', rid] });
      await options.queryClient.invalidateQueries({ queryKey: ['run', rid] });
      await options.queryClient.invalidateQueries({ queryKey: ['run-checkpoints', rid] });
      await options.queryClient.invalidateQueries({ queryKey: ['runs'] });
      setOpen(false);
      setSuggestions([]);
      setAnchorStepId(null);
    } catch (e) {
      console.error('bulkSkipReplay failed', e);
    } finally {
      setBusy(false);
    }
  }, [options.runId, options.queryClient, anchorStepId, suggestions]);

  return {
    skipReplayModalOpen: open,
    skipReplayAnchorStepId: anchorStepId,
    skipReplaySuggestions: suggestions,
    skipReplayBusy: busy,
    promptAfterStepChange,
    dismissSkipReplayModal: dismiss,
    confirmSkipReplaySuggestions: confirm,
  };
}
