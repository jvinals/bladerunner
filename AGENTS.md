## Learned User Preferences
- When generating Playwright for modern SPAs, bake strict anti-flakiness interaction rules into the prompt/template instead of relying on generic selectors or `.fill()` for custom controls.
- For LLM-driven browser actions, include a tagged Set-of-Marks screenshot plus a matching accessibility or actionable-node tree in the model context.
- For AI prompt and vision flows, phrase steps as neutral QA on staging or local apps (e.g. verify errors, permissions, expected messages) rather than attack-like imperatives, to reduce empty model output from safety refusals.

## Learned Workspace Facts
- BladeRunner's default Clerk OTP mode for automatic sign-in should be MailSlurp when no explicit mode is selected.
- Automatic sign-in during recording and playback is modeled as one first-class step, with provider-specific auth metadata kept separate from the normal Playwright step chain.
- Generic email/password automatic sign-in should tolerate delayed auth UI and staged email-then-password flows (and similar) before failing; OTP completion must not treat same-host URLs as success while the OTP UI is still active.
- AI Prompt steps split script generation from script execution; `Done` should only succeed after both have run and should not rerun a test that already passed.
- AI Visual ID is run-scoped (tests and history attach to the run); in the Add AI prompt step drawer, keep the `5.- AI Visual ID` block below item #4 (not above the numbered steps). The Tree modal should show a Playwright-style accessibility snapshot (role, accessible name, and key attributes in a clear hierarchy), not an unstructured tree dominated by unnamed nodes.
- For resumable runs, playback and continue-recording on run detail should key off whether a live recording session exists (not only persisted `RECORDING` status), because a run can be open for recording without an active in-memory browser session.
- Run detail should keep `Continue recording` available during playback; handoff to the recording workspace should not block on awaiting full playback teardown (stop playback in the background).
- Playback must rewrite or escape Playwright locator strings that embed single quotes inside `.locator('...')` / `.locator("...")` (e.g. `[class*='...']`) so the snippet stays valid JavaScript when compiled for execution.
