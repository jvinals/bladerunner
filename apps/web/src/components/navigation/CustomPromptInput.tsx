/**
 * Sidebar control for live prompt injection: analyze (mock LLM) then confirm on canvas.
 */

import { useState, useCallback } from 'react';

interface CustomPromptInputProps {
  disabled: boolean;
  onAnalyze: (text: string) => void;
}

export function CustomPromptInput({ disabled, onAnalyze }: CustomPromptInputProps) {
  const [text, setText] = useState('');

  const submit = useCallback(() => {
    const v = text.trim();
    if (!v || disabled) return;
    onAnalyze(text);
  }, [text, disabled, onAnalyze]);

  return (
    <div className="px-3 py-3 border-b border-gray-100 space-y-2">
      <h4 className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
        Live prompt
      </h4>
      <textarea
        className="w-full rounded-md border border-gray-200 px-2.5 py-2 text-xs min-h-[72px] focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 disabled:bg-gray-50 disabled:text-gray-400"
        placeholder="Describe what to do on the page…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        disabled={disabled || !text.trim()}
        className="w-full rounded-lg bg-violet-600 text-white text-xs font-medium py-2 px-3 disabled:opacity-50 hover:bg-violet-700 transition-colors"
        onClick={submit}
      >
        Analyze prompt
      </button>
      <p className="text-[10px] text-gray-400 leading-snug">
        Mock analysis highlights a target on the stream. Use Confirm or Cancel on the canvas before
        other clicks.
      </p>
    </div>
  );
}
