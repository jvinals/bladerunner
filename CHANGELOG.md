# Changelog

## 2026-03-25

- `0.10.30`: removed the temporary measurement probe used to validate the compact “Models by task” card height reduction.
- `@bladerunner/web 0.7.23`: cleaned up debug-only task-card measurement hooks while keeping the compact table layout.
- `0.10.29`: condensed the AI / LLM “Models by task” card into a table-like layout to cut its vertical footprint substantially.
- `@bladerunner/web 0.7.22`: replaced per-row stacked labels with a shared header row and compact single-line task/provider/model/connection rows.
- `0.10.28`: removed temporary instrumentation and repro artifacts after confirming the AI / LLM save fix.
- `@bladerunner/web 0.7.21`: cleaned up the temporary save-path debug probe from the settings UI.
- `@bladerunner/api 0.6.35`: removed temporary save-path debug probes and repro helpers while keeping the no-op credential save fix.
- `0.10.27`: fixed AI / LLM settings saves so model-routing changes no longer fail when credential encryption is unset and no credentials are actually being changed.
- `@bladerunner/api 0.6.34`: pruned empty provider credential fields before persistence and skipped credential writes for no-op saves.
- `0.10.26`: removed temporary AI / LLM debug instrumentation after confirming the provider-status fix.
- `@bladerunner/web 0.7.20`: cleaned up runtime logging probes from the settings UI while keeping the final status behavior intact.
- `0.10.25`: aligned the AI / LLM provider list status with live test results so failed provider tests no longer show as green in the left rail.
- `@bladerunner/web 0.7.19`: made the provider list show `testing`, `connected`, or `test failed` based on the latest connection test before falling back to static configuration state.
- `0.10.24`: added Cerebras, MiniMax, Kimi, and Qwen as built-in AI / LLM providers with OpenAI-compatible defaults and suggested model seeds.
- `@bladerunner/api 0.6.33`: extended the LLM provider registry with Cerebras, MiniMax, Kimi, and Qwen plus curated starter model ids.
- `0.10.23`: tightened the AI / LLM settings density by compressing the "Models by task" card and converting provider model rows into a one-line table with launch dates when provider metadata is available.
- `@bladerunner/web 0.7.18`: reduced task-card row height and added compact model-list columns for model id and launch date.
- `@bladerunner/api 0.6.32`: extended provider model responses to include launch-date metadata where available.
