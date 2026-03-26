## Learned User Preferences
- When generating Playwright for modern SPAs, bake strict anti-flakiness interaction rules into the prompt/template instead of relying on generic selectors or `.fill()` for custom controls.
- For LLM-driven browser actions, include a tagged Set-of-Marks screenshot plus a matching accessibility or actionable-node tree in the model context.

## Learned Workspace Facts
- BladeRunner's default Clerk OTP mode for automatic sign-in should be MailSlurp when no explicit mode is selected.
- Automatic sign-in during recording and playback is modeled as one first-class step, with provider-specific auth metadata kept separate from the normal Playwright step chain.
- AI Prompt steps split script generation from script execution; `Done` should only succeed after both have run and should not rerun a test that already passed.
