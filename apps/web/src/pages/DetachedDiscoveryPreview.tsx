import { useParams } from 'react-router-dom';
import { useDiscoveryLive } from '@/hooks/useDiscoveryLive';

/**
 * Full-window live JPEG stream + discovery agent log (join `run:discovery-${projectId}`).
 */
export default function DetachedDiscoveryPreview() {
  const { projectId } = useParams<{ projectId: string }>();
  const { frameDataUrl, connected, logLines, formatLogTime } = useDiscoveryLive(projectId, {
    enabled: !!projectId,
  });

  return (
    <div className="w-screen h-screen bg-gray-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[#4B90FF] font-bold text-sm">Bladerunner</span>
          <span className="text-gray-400 text-xs">Detached discovery preview</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-xs text-gray-400">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <div className="flex-1 flex items-center justify-center overflow-auto p-4 min-h-0">
          {frameDataUrl ? (
            <img
              src={frameDataUrl}
              alt="Discovery browser stream"
              className="max-w-full max-h-full object-contain rounded shadow-2xl"
            />
          ) : (
            <p className="text-sm text-gray-500 text-center px-6">
              Waiting for frames… Run app discovery from Projects if the stream has not begun.
            </p>
          )}
        </div>
        <div className="w-full md:w-[min(40rem,48vw)] shrink-0 border-t md:border-t-0 md:border-l border-gray-700 flex flex-col bg-gray-950 min-h-[16rem] md:min-h-0">
          <div className="px-3 py-2 bg-gray-800 border-b border-gray-700">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Discovery agent log
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 text-[10px] leading-snug text-gray-300">
            {logLines.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No log lines yet.</p>
            ) : (
              logLines.map((line, i) => (
                <div key={`${line.at}-${i}`} className="border-b border-gray-700/80 pb-1.5 mb-1.5 last:border-0">
                  <div className="text-gray-500 tabular-nums">{formatLogTime(line.at)}</div>
                  <div className="text-gray-200 whitespace-pre-wrap break-words">{line.message}</div>
                  {line.detail != null && Object.keys(line.detail).length > 0 && (
                    <pre className="text-[9px] text-gray-500 mt-0.5 whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
                      {JSON.stringify(line.detail)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <p className="text-[10px] text-gray-500 text-center px-4 py-2 border-t border-gray-800 shrink-0">
        Read-only stream · controls stay on the Projects page
      </p>
    </div>
  );
}
