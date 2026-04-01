/** Limits for WebSocket / discovery agent log payloads (avoid multi‑MB events). */
export const DISCOVERY_LLM_LOG_MAX_PROMPT_CHARS = 120_000;
export const DISCOVERY_LLM_LOG_MAX_RESPONSE_CHARS = 200_000;
export const DISCOVERY_LLM_LOG_MAX_THINKING_CHARS = 80_000;
/** Raw base64 length cap for including JPEG in log detail; larger images are omitted with a size note. */
export const DISCOVERY_LLM_LOG_MAX_IMAGE_B64_CHARS = 80_000;

export function truncateDiscoveryLlmField(s: string, max: number): { value: string; truncated: boolean } {
  if (s.length <= max) return { value: s, truncated: false };
  return { value: `${s.slice(0, max)}\n… [truncated]`, truncated: true };
}

export type DiscoveryLlmExchangePayload = {
  kind: 'explore' | 'final';
  usageKey: 'project_discovery';
  sent: {
    systemPrompt: string;
    systemPromptTruncated?: boolean;
    userPrompt: string;
    userPromptTruncated?: boolean;
    hasImage: boolean;
    imageBase64?: string;
    imageTruncated?: boolean;
    imageOmittedDueToSize?: boolean;
    imageSizeChars?: number;
  };
  received: {
    content: string;
    contentTruncated?: boolean;
    thinking?: string;
  };
};

export function buildDiscoveryImageSentFields(shot: string): Pick<
  DiscoveryLlmExchangePayload['sent'],
  'hasImage' | 'imageBase64' | 'imageTruncated' | 'imageOmittedDueToSize' | 'imageSizeChars'
> {
  const t = shot.trim();
  if (t.length === 0) {
    return { hasImage: false };
  }
  if (t.length <= DISCOVERY_LLM_LOG_MAX_IMAGE_B64_CHARS) {
    return { hasImage: true, imageBase64: t, imageTruncated: false };
  }
  return { hasImage: true, imageOmittedDueToSize: true, imageSizeChars: t.length };
}
