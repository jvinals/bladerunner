import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ChatMessage, LlmChatOptions, LlmChatResult } from './providers/llm-provider.interface';

/**
 * Minimal Gemini text/multimodal chat for shared LlmService routes (action → instruction, explain, skip suggest).
 */
export async function geminiChat(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: LlmChatOptions,
): Promise<LlmChatResult> {
  const systemMsg = messages.find((m) => m.role === 'system');
  const userText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n\n');

  const genAI = new GoogleGenerativeAI(apiKey);
  const gm = genAI.getGenerativeModel({
    model,
    ...(systemMsg?.content?.trim() ? { systemInstruction: systemMsg.content } : {}),
  });

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: userText }];
  if (options?.imageBase64?.trim()) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: options.imageBase64.trim(),
      },
    });
  }

  const result = await gm.generateContent(
    {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.2,
      },
    },
    { signal: options?.signal },
  );

  const rawText = result.response.text().trim();
  if (!rawText) {
    throw new Error('Gemini returned empty text');
  }
  return { content: rawText };
}
