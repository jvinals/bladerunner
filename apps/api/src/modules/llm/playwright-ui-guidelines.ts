/**
 * Shared LLM instructions for Playwright against modern SPAs (Shadcn, Radix, portaled comboboxes).
 * Imported by evaluation codegen, Gemini instruction/verify templates, recorder action→instruction, and discovery explorer.
 */

/** Full block injected into evaluation codegen and Gemini templates. */
export const PLAYWRIGHT_UI_INTERACTION_GUIDELINES = `**UI Interaction Guidelines & Playwright Best Practices:**
When interacting with complex web applications (especially those using React component libraries like Shadcn or Radix UI), you must strictly adhere to the following rules:

1. **Enforce Atomic Steps:** Do not attempt multi-step interactions (e.g., clicking a dropdown, typing a search, and selecting an option) in a single block of code. Execute ONE logical action per step so the DOM can update and a fresh accessibility tree can be provided for the next step.
2. **Comboboxes and Dropdowns:** - NEVER use \`.fill()\` or \`.type()\` directly on a \`<button role="combobox">\`.
   - ALWAYS \`.click()\` the combobox trigger first to expand the menu.
   - In the subsequent step, locate the newly spawned search \`<input>\` (often placed in a React Portal at the end of the \`<body>\`) to type the search query.
3. **Soft Locators & Regex:** Avoid using \`exact: true\` when matching text within dropdown options or heavily styled components. Rendered text may contain invisible spans or formatting. Always use case-insensitive regex for text matching.
   - *Bad:* \`await page.getByRole('option', { name: 'Dr. Javier Vinals', exact: true }).click();\`
   - *Good:* \`await page.getByRole('option', { name: /Javier Vinals/i }).click();\`
4. **React Portals & Animations:** Assume that dropdown options, modals, and popovers use CSS transitions and React Portals. Elements might be attached outside the main component tree and take a fraction of a second to become visible. Write code that inherently respects Playwright's auto-waiting mechanisms for visibility and actionability.
5. **Shadcn Select vs Combobox (critical — avoid timeouts):** Radix **Select** (\`@radix-ui/react-select\`, used by many Shadcn \`<Select>\` rows) typically exposes the **closed** trigger as \`role="button"\` with the **current value** as visible text — **not** \`role="combobox"\`. Searchable **Combobox** (\`cmdk\`, \`Popover\` + input) often **is** \`combobox\`. Do **not** default to \`getByRole('combobox', { name: /Name/i })\` for a "Search by" / field-type picker; it often **matches nothing** and times out. Instead: read the accessibility snapshot / manifest for that row's actual \`role\` and name; scope under \`getByRole('dialog', { name: /…/i })\` when inside a modal; try \`getByRole('button', { name: /…/i })\`, \`getByLabel\`, or \`getByPlaceholder\` (e.g. patient search \`First Name Last Name\`) when that is the real target. Prefer the interactive manifest line for the exact control over guessing \`combobox\`.
6. **Search/filter then pick (patient search, cmdk):** After typing a filter, options may **lag** or render in a **portaled** \`listbox\`. Wait for \`listbox\` or \`option\` to become visible before clicking: e.g. \`await page.getByRole('option', { name: /Alina/i }).first().waitFor({ state: 'visible', timeout: 15000 })\` or scope \`page.getByRole('listbox').getByRole('option', { name: /…/i })\` when multiple lists exist. If \`option\` never appears, try a **row** or **cell** in the results table (see manifest) instead of only \`option\`.
7. **Do not repeat the same failed locator:** If prior steps show repeated **FAIL** or nearly identical titles for the same goal (e.g. "Select patient…"), you must **change strategy**—different role, listbox scope, button trigger, placeholder, or manifest index—do **not** re-emit the same \`getByRole\` / locator pattern as the previous failed step.`;

/** Shorter variant for recorder action→instruction and discovery explorer (same rules, fewer tokens). */
export const PLAYWRIGHT_UI_INTERACTION_GUIDELINES_CONDENSED = `Shadcn/Radix: Select triggers are often role=button not combobox—check snapshot/manifest; scope dialog; use getByPlaceholder/getByLabel when appropriate. Atomic steps; pressSequentially in portaled filter input; soft regex on options; auto-wait for portals. Search/filter: wait for listbox/option or row; listbox-scope options. If prior steps FAIL on same goal, change locator strategy—do not repeat.`;
