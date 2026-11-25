# Claude Code kickoff prompt

Unzip this folder where you keep your repos, `cd` into `multilist-item-creator`, start Claude Code there, and paste the prompt below.

---

We're starting a new Sitecore Marketplace app: **Multilist Item Creator**. The approved design is in `docs/superpowers/specs/2026-11-25-multilist-item-creator-design.md` and the implementation plan is in `docs/superpowers/plans/2026-11-25-multilist-item-creator.md`. Read both fully before doing anything.

Use my Content Transfer app as the reference for conventions: https://github.com/rvadherhztl03/sitecore-content-transfer. Clone it to `../sitecore-content-transfer` (read-only reference; never commit to it). Copy its patterns as the plan says: Next.js 15 `src/` layout, `useMarketplaceClient` hook with the XMC module, `src/lib/sdk.ts` (`SdkClient`, `SdkError`, `call`, `graphql`, `toEnvs`), `src/test/fakeClient.ts`, Vitest setup, Blok/shadcn UI components, README style. Copy only what this app uses.

Setup:
1. `git init` this folder, first commit with the spec, the plan and this file.
2. Create a public GitHub repo `sitecore-multilist-item-creator` with `gh repo create` and push. Ask me before creating it if `gh` isn't authenticated.

Then execute the plan with superpowers:subagent-driven-development, starting at Task 0.

Task 0 is a spike I have to run inside SitecoreAI myself. Build the throwaway logging page, tell me exactly what to register in App Studio and what to click, and wait for me to paste back what it logged. Write `docs/spike-findings.md` from that. **Stop after Task 0 and report:** if the field can't tell which item it's on (for both page fields and datasource fields), we don't continue with this plan.

Rules that apply to every task: no credentials or secrets anywhere, all Sitecore calls through the Marketplace SDK as the signed-in user; never overwrite the target multilist, always re-read and append; `npm test` passes before every commit.
