import { GoogleGenerativeAI } from '@google/generative-ai';

/** Placeholder replaced with the user’s natural-language instruction. */
export const GEMINI_INSTRUCTION_ACTION_PLACEHOLDER = '[TEXT INTRODUCED BY THE USER IN "AI PROMPT"]';

const GEMINI_INSTRUCTION_TEMPLATE = `You are an expert Playwright automation engineer.

I am attaching a screenshot of a software application UI.

Your job is to generate only one Playwright TypeScript instruction snippet that performs the exact action I request, using the screenshot as the main source of UI understanding.

Action to perform:
${GEMINI_INSTRUCTION_ACTION_PLACEHOLDER}

Strict output rules:
Return only valid Playwright TypeScript code.
Do not include explanations.
Do not include markdown fences.
Do not include titles, notes, assumptions, comments, or alternatives.
Do not describe the screenshot.
Do not output pseudocode.
Do not output anything before or after the Playwright code.

Implementation requirements:
Infer the most likely UI structure from the screenshot.
Write the most robust production style Playwright snippet possible.
Make it resilient to different content, dynamic values, user data, themes, settings, layouts, and configuration states.
Avoid brittle selectors such as exact text matches when text may vary, screen coordinates, absolute positions, and fragile nth child chains.
Prefer stable locators such as role, label, placeholder, test id, aria attributes, stable attributes, and layered fallback locators.
Handle likely UI variations when relevant, including dialogs, menus, tabs, loading states, collapsed sections, empty or prefilled fields, and toggles already in the desired state.
Use only the minimum waits needed and follow Playwright best practices.
If the screenshot is not sufficient to know a perfect selector, still output the strongest practical Playwright snippet with intelligent fallback locators.

Output format requirement:
The response must be strictly the Playwright instruction snippet and nothing else. Your entire response must be executable Playwright TypeScript only.
`;

/** Full text sent to Gemini (user turn) including substituted action. */
export function buildGeminiInstructionPrompt(instruction: string): string {
  const action = instruction.trim();
  return GEMINI_INSTRUCTION_TEMPLATE.replace(GEMINI_INSTRUCTION_ACTION_PLACEHOLDER, action);
}

/** Strip accidental markdown fences; trim. Model should not emit them per template. */
export function normalizeGeminiPlaywrightSnippet(raw: string): string {
  let t = raw.trim();
  const fenced = /^```(?:typescript|ts|javascript|js)?\s*\n?([\s\S]*?)```\s*$/m.exec(t);
  if (fenced) {
    t = fenced[1].trim();
  }
  return t.trim();
}

/** Extract incremental text / thought from one streamed chunk (avoids response.text() throwing on partial blocks). */
function extractChunkParts(chunk: unknown): { text: string; thought: string } {
  let text = '';
  let thought = '';
  const c = chunk as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
  };
  const parts = c.candidates?.[0]?.content?.parts;
  if (!parts) return { text: '', thought: '' };
  for (const part of parts) {
    if (typeof part.thought === 'string') {
      thought += part.thought;
    } else if (typeof part.text === 'string') {
      text += part.text;
    }
  }
  return { text, thought };
}

export type GeminiInstructionStreamProgress = { rawText: string; thinking?: string };

export async function generateGeminiPlaywrightSnippet(params: {
  apiKey: string;
  model: string;
  instruction: string;
  imageBase64: string;
  signal?: AbortSignal;
  /** Called with cumulative text as the stream arrives (throttled). */
  onProgress?: (ev: GeminiInstructionStreamProgress) => void;
}): Promise<{ rawText: string; playwrightCode: string; thinking?: string }> {
  const { apiKey, model, instruction, imageBase64, signal, onProgress } = params;
  const prompt = buildGeminiInstructionPrompt(instruction);
  const genAI = new GoogleGenerativeAI(apiKey);
  const gm = genAI.getGenerativeModel({ model });
  const { stream, response } = await gm.generateContentStream(
    {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageBase64.trim(),
              },
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.2,
      },
    },
    { signal },
  );

  let accumulated = '';
  let thinkingAcc = '';
  let lastEmitAt = 0;
  let lastEmittedLen = 0;
  const THROTTLE_MS = 120;
  const MIN_CHARS = 220;

  const emitProgress = (force: boolean) => {
    if (!onProgress) return;
    const now = Date.now();
    const len = accumulated.length;
    if (
      !force &&
      now - lastEmitAt < THROTTLE_MS &&
      len - lastEmittedLen < MIN_CHARS &&
      len > 0
    ) {
      return;
    }
    lastEmitAt = now;
    lastEmittedLen = len;
    const t = thinkingAcc.trim();
    onProgress({
      rawText: accumulated,
      ...(t ? { thinking: t } : {}),
    });
  };

  for await (const chunk of stream) {
    const { text, thought } = extractChunkParts(chunk);
    accumulated += text;
    thinkingAcc += thought;
    emitProgress(false);
  }

  await response;
  emitProgress(true);

  const rawText = accumulated.trim();
  if (!rawText) {
    throw new Error('Gemini returned empty text for Playwright snippet');
  }
  const thinking = thinkingAcc.trim() || undefined;
  return {
    rawText,
    playwrightCode: normalizeGeminiPlaywrightSnippet(rawText),
    ...(thinking ? { thinking } : {}),
  };
}
