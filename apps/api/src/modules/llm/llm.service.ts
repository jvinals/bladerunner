import { Injectable, Logger } from '@nestjs/common';
import {
  LlmProvider,
  ActionToInstructionInput,
  ActionToInstructionOutput,
  InstructionToActionInput,
  InstructionToActionOutput,
} from './providers/llm-provider.interface';

const ACTION_TO_INSTRUCTION_SYSTEM = `You are a Playwright test recorder assistant. Given a browser action and page context, produce:
1. A concise human-readable instruction describing what the user did
2. Clean Playwright code that reproduces the action

Respond ONLY with valid JSON: { "instruction": "...", "playwrightCode": "..." }

Guidelines:
- Instructions should be natural language, e.g. "Click the 'Sign In' button in the navigation bar"
- **Visible text** (if provided) is the element's innerText from the browser — use it for the instruction name (e.g. "Click the Patients item in the sidebar"). Never say "empty span" or "empty element" when Visible text is non-empty. **Aria label** (if provided) names icon-only controls.
- Element HTML may be truncated; prefer Visible text and Aria label over HTML when they disagree with an empty-looking tag.
- For TYPE actions, use Element HTML attributes: input[type="password"] or autocomplete="current-password" means password field; type="email", name="identifier", or email-like placeholders mean email/username. Never describe typing a password into an email field or vice versa.
- The "Selector" field is the clicked element's CSS selector from the browser (tag + #id, classes, or [data-testid]). When it contains a class, id, or attribute (not just a bare tag name), prefer await page.locator(<that exact selector as a single-quoted or JSON string>) for clicks/fills so replay targets the same node.
- Playwright code should use modern locator APIs (getByRole, getByText, getByLabel) when possible
- For modal/dialog close buttons, never emit a bare page.locator with only a path[d="..."] Lucide X shape or other SVG path alone — the same path repeats on row actions vs the dialog chrome. Prefer getByRole('dialog') combined with getByRole('button', { name: /close|dismiss/i }), getByLabel, or a locator scoped to the open dialog.
- NEVER use page.locator('span'), page.locator('div'), page.locator('a'), page.locator('button'), or page.locator('input') alone — they match many elements and Playwright throws a strict mode violation. When Visible text is available for a click, prefer getByText(visibleText, { exact: true }).first() or getByRole with name from Visible text / aria (exact: false on getByText matches substrings like "Total Patients"). Otherwise use getByRole('link', { name: '...' }), page.locator(<Selector field>) when specific, or page.locator('span', { hasText: '...' }).first() if you must scope by tag.
- Keep instructions concise but specific enough to identify the target element`;

const INSTRUCTION_TO_ACTION_SYSTEM = `You are a Playwright test automation agent. Given a natural language instruction and the current page context, generate the Playwright code to execute the action.

Respond ONLY with valid JSON:
{
  "playwrightCode": "...",
  "action": "click|type|navigate|scroll|select|hover|wait|assert|custom",
  "selector": "CSS selector or null",
  "value": "input value or null"
}

Guidelines:
- Use modern Playwright locator APIs (getByRole, getByText, getByLabel, getByPlaceholder) when possible
- NEVER emit page.locator('span'), page.locator('div'), page.locator('a'), page.locator('button'), or page.locator('input') with only a tag name — strict mode will fail when multiple elements match. Prefer getByRole with name, or locator with hasText, or .first() only as a last resort.
- For navigation, use page.goto()
- For typing, use page.fill() or page.getByLabel().fill()
- **Date inputs (\`input[type="date"]\`)**: Playwright \`fill()\` only accepts **ISO 8601** values: \`YYYY-MM-DD\` (e.g. \`1980-01-01\`). Slash formats like \`01/01/1980\` or \`MM/DD/YYYY\` cause **"Malformed value"**. If the user prompt gives a human date, **convert it to ISO** in the generated fill string. Use the screenshot/a11y tree to confirm \`type="date"\`.
- Handle waiting implicitly (Playwright auto-waits)
- Only generate safe Playwright API calls (no eval, no fs, no network)`;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private provider: LlmProvider | null = null;

  setProvider(provider: LlmProvider) {
    this.provider = provider;
  }

  getProvider(): LlmProvider | null {
    return this.provider;
  }

  async actionToInstruction(
    input: ActionToInstructionInput,
  ): Promise<ActionToInstructionOutput> {
    if (!this.provider) {
      const label = input.elementVisibleText?.trim() || input.ariaLabel?.trim();
      return {
        instruction:
          input.action === 'click' && label
            ? `Click ${label}`
            : `${input.action} on ${input.selector}`,
        playwrightCode: `// ${input.action}: ${input.selector}`,
      };
    }

    const userPrompt = `Action: ${input.action}
Selector: ${input.selector}
Element HTML: ${input.elementHtml}
${input.elementVisibleText ? `Visible text: ${input.elementVisibleText}\n` : ''}${input.ariaLabel ? `Aria label: ${input.ariaLabel}\n` : ''}${input.value ? `Value: ${input.value}\n` : ''}Page context (accessibility tree excerpt):
${input.pageAccessibilityTree.slice(0, 3000)}`;

    try {
      const response = await this.provider.chat([
        { role: 'system', content: ACTION_TO_INSTRUCTION_SYSTEM },
        { role: 'user', content: userPrompt },
      ]);

      return JSON.parse(response);
    } catch (err) {
      this.logger.error('actionToInstruction failed', err);
      const label = input.elementVisibleText?.trim() || input.ariaLabel?.trim();
      return {
        instruction:
          input.action === 'click' && label
            ? `Click ${label}`
            : `${input.action} on ${input.selector}`,
        playwrightCode: `// ${input.action}: ${input.selector}`,
      };
    }
  }

  async instructionToAction(
    input: InstructionToActionInput,
  ): Promise<InstructionToActionOutput> {
    if (!this.provider) {
      throw new Error('LLM provider not configured. Set LLM_PROVIDER and the corresponding API key in .env');
    }

    const userPrompt = `Instruction: ${input.instruction}
Current page URL: ${input.pageUrl}
Page context (accessibility tree):
${input.pageAccessibilityTree.slice(0, 4000)}`;

    const response = await this.provider.chat(
      [
        { role: 'system', content: INSTRUCTION_TO_ACTION_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      {
        imageBase64: input.screenshotBase64,
      },
    );

    return JSON.parse(response);
  }
}
