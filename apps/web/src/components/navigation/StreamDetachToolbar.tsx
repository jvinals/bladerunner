/**
 * Pop out / dock controls for navigation canvas streams (record + play).
 */

import { Monitor, PictureInPicture2 } from 'lucide-react';

export interface StreamDetachToolbarProps {
  detached: boolean;
  onDetach: () => void;
  onDock: () => void;
  /** Disable pop-out (e.g. no stream yet). */
  disabled?: boolean;
}

export function StreamDetachToolbar({
  detached,
  onDetach,
  onDock,
  disabled = false,
}: StreamDetachToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 mb-2">
      {!detached ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onDetach}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          title="Open the live stream in a separate window"
        >
          <PictureInPicture2 size={14} className="text-slate-500" aria-hidden />
          Pop out stream
        </button>
      ) : (
        <button
          type="button"
          onClick={onDock}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          title="Close the detached window and show the stream here again"
        >
          <Monitor size={14} className="text-slate-500" aria-hidden />
          Dock stream
        </button>
      )}
    </div>
  );
}
