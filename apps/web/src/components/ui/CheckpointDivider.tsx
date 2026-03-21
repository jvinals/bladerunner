import { useState, useEffect } from 'react';
import { runsApi } from '@/lib/api';
import { Camera } from 'lucide-react';

export interface CheckpointData {
  id: string;
  afterStepSequence: number;
  label: string;
  pageUrl: string | null;
  thumbnailPath: string | null;
}

interface CheckpointDividerProps {
  runId: string;
  checkpoint: CheckpointData;
}

export function CheckpointDivider({ runId, checkpoint }: CheckpointDividerProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!checkpoint.thumbnailPath) return;
    let revoked = false;
    runsApi.getCheckpointThumbnailUrl(runId, checkpoint.id).then((url) => {
      if (!revoked && url) setThumbUrl(url);
    });
    return () => {
      revoked = true;
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    };
    // only refetch when checkpoint id changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, checkpoint.id, checkpoint.thumbnailPath]);

  return (
    <div className="relative flex items-center gap-2 my-1.5 px-2">
      <div className="flex-1 border-t border-dashed border-[#4B90FF]/30" />
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#4B90FF]/8 border border-[#4B90FF]/20 text-[9px] font-medium text-[#2563EB] hover:bg-[#4B90FF]/15 transition-colors whitespace-nowrap"
      >
        <Camera size={10} />
        {checkpoint.label || `State after step ${checkpoint.afterStepSequence}`}
      </button>
      <div className="flex-1 border-t border-dashed border-[#4B90FF]/30" />

      {expanded && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 max-w-[320px] w-full">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={checkpoint.label}
              className="w-full rounded border border-gray-100"
            />
          ) : (
            <p className="text-[10px] text-gray-400 text-center py-3">No thumbnail available</p>
          )}
          {checkpoint.pageUrl && (
            <p className="text-[9px] text-gray-400 mt-1 truncate" title={checkpoint.pageUrl}>
              {checkpoint.pageUrl}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
