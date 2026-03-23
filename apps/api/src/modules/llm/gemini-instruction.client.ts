import { GoogleGenerativeAI } from '@google/generative-ai';

/** Placeholder replaced with the user’s natural-language task for the AI prompt step. */
export const GEMINI_INSTRUCTION_ACTION_PLACEHOLDER = '[DESCRIBE THE TASK HERE]';

const GEMINI_INSTRUCTION_TEMPLATE = `You are an expert Playwright automation engineer.

I am attaching a screenshot of a software application UI.

Your job is to generate only one continuous Playwright TypeScript snippet that performs the requested task based on the screenshot.

Task to perform:
${GEMINI_INSTRUCTION_ACTION_PLACEHOLDER}

Strict output rules:
Return only valid Playwright TypeScript code.
Do not include explanations.
Do not include markdown fences.
Do not include titles, notes, assumptions, comments, or alternatives.
Do not describe the screenshot.
Do not output pseudocode.
Do not output anything before or after the Playwright code.

Execution requirements:
The code may contain one or multiple sequential Playwright actions, depending on what is necessary to complete the task correctly.
Do not artificially limit the solution to a single instruction if multiple steps are needed.
Generate only the minimum necessary sequence of actions required to achieve the task reliably.

Implementation requirements:
Infer the most likely UI structure from the screenshot.
Write the most robust production style Playwright snippet possible.
Make it resilient to different content, dynamic values, user data, themes, settings, layouts, and configuration states.
Avoid brittle selectors such as exact text matches when text may vary, screen coordinates, absolute positions, and fragile nth child chains.
Prefer stable locators such as role, label, placeholder, test id, aria attributes, stable attributes, and layered fallback locators.
When reading or acting on a single HTML table, use page.locator('table').first() (or a more specific selector) so strict mode does not fail if multiple tables exist.
For combobox or search-as-you-type dropdowns, prefer getByRole('option', { name: ... }) or options under the listbox/dialog over very broad tag unions (e.g. mixing div and li) that can match the wrong node.
If the snippet picks the next item from a list by scanning existing page text, handle the case when no item remains so the code does not silently skip work.
Handle likely UI variations when relevant, including dialogs, menus, tabs, loading states, collapsed sections, empty or prefilled fields, and controls already in the desired state.
Use only the minimum waits needed and follow Playwright best practices.
If the screenshot is not sufficient to know a perfect selector, still output the strongest practical Playwright snippet with intelligent fallback locators.

Output format requirement:
Your entire response must be executable Playwright TypeScript only, consisting of the full sequence of actions needed to complete the task.
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

/**
 * Extract incremental answer vs thought-summary text from one streamed chunk.
 * Gemini returns thought summaries with `thought: true` and the summary in `text` (not `thought` as a string).
 * @see https://ai.google.dev/gemini-api/docs/thinking
 */
function extractChunkParts(chunk: unknown): { text: string; thought: string } {
  let text = '';
  let thought = '';
  const c = chunk as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
  };
  const parts = c.candidates?.[0]?.content?.parts;
  if (!parts) return { text: '', thought: '' };
  for (const part of parts) {
    const t = typeof part.text === 'string' ? part.text : '';
    if (!t) continue;
    const isThought = part.thought === true;
    if (isThought) {
      thought += t;
    } else {
      text += t;
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
        thinkingConfig: {
          includeThoughts: true,
        },
      } as import('@google/generative-ai').GenerationConfig & {
        thinkingConfig?: { includeThoughts?: boolean };
      },
    },
    { signal },
  );

  let accumulated = '';
  let thinkingAcc = '';
  let lastEmitAt = 0;
  let lastEmittedCombined = 0;
  const THROTTLE_MS = 120;
  const MIN_CHARS = 220;

  const emitProgress = (force: boolean) => {
    if (!onProgress) return;
    const now = Date.now();
    const combined = accumulated.length + thinkingAcc.length;
    if (
      !force &&
      now - lastEmitAt < THROTTLE_MS &&
      combined - lastEmittedCombined < MIN_CHARS &&
      combined > 0
    ) {
      return;
    }
    lastEmitAt = now;
    lastEmittedCombined = combined;
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
