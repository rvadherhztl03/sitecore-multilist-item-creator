# Multilist Item Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Marketplace app whose Page builder custom field lets an editor create a new item and append it to a sibling native Multilist field, without leaving the Page builder.

**Architecture:** One Next.js app, one extension point (Page builder custom field, route `/custom-field-extension`). The companion field's own value holds a JSON config (set on Standard Values). The modal reads that config and the page from the SDK, finds the field's item among the page and its layout's datasources (the SDK doesn't say which item opened it; see `docs/spike-findings.md`), creates the item through `xmc.authoring.graphql`, then re-reads and appends to the target multilist. Pure logic lives in `src/lib/*` and is unit-tested against a fake SDK client; UI lives in `src/components/creator/*`.

**Tech Stack:** Next.js 15 (App Router, `src/`), React 19, TypeScript 5.9, `@sitecore-marketplace-sdk/client` + `@sitecore-marketplace-sdk/xmc`, Tailwind 4 + Blok/shadcn UI, Vitest 4 + Testing Library + jsdom. Same versions as Content Transfer.

**Spec:** `docs/superpowers/specs/2026-11-25-multilist-item-creator-design.md`

**Reference repo:** Content Transfer (`https://github.com/rvadherhztl03/sitecore-content-transfer`). Copy its patterns, not its features.

## Global Constraints

- No credentials, secrets or hosts in env variables or config. Every Sitecore call goes through the Marketplace SDK as the signed-in user.
- The editor flow never calls `client.setValue` on the companion field. Only the Setup view may write config, and only when the user presses Save in Setup.
- Never replace the target multilist's value: always re-read it immediately before writing and append.
- Item IDs are stored in Sitecore's multilist format: uppercase GUIDs in braces, joined by `|` (e.g. `{AB12…}|{CD34…}`). Compare IDs case- and brace-insensitively.
- Reuse Content Transfer's `SdkClient` / `SdkError` / `call` / `graphql` shapes and its `fakeClient` test helper (trimmed to what this app uses).
- Every `src/lib` module gets a colocated `*.test.ts`; components get `*.test.tsx`. `npm test` must pass before each commit.
- User-facing copy is plain English, sentences under 25 words, no jargon beyond "item", "field", "template", "folder".

## Review Focus

1. **Item already selected** (same ID present, different case or no braces) → not added twice. Test in Task 5.
2. **Target multilist empty** (value `""` or null) → result is just the new ID, no leading `|`. Test in Task 5.
3. **Item name with characters Sitecore rejects** (`/ \ : ? " < > | [ ] *`, leading/trailing spaces, empty) → blocked in the form with a message before any API call. Test in Task 6.
4. **Created but append failed** → modal shows the new item's path and says to select it manually; does not retry the create. Test in Task 7.
5. **No config on the item** (Standard Values not set, value empty or invalid JSON) → modal shows "This field isn't set up yet" and a Setup link, never a crash. Test in Task 7.
6. **Field's item lookup**: empty or invalid config is never matched by value (it would match every empty field); several matches → the editor picks; no match → a message, nothing written. Test in Tasks 3 and 7.
7. **Authoring API IDs come back compact** (`c49bf206…`, 32 hex, no dashes or braces) → normalized before they're compared or written. Test in Tasks 2, 5 and 6.

---

### Task 0: Spike — what does the custom field context expose? (THROWAWAY) — DONE 2026-11-25

Result in `docs/spike-findings.md`. The SDK gives the page, not the item or field that opened the app; the item is found by value match (Task 3). `pages.reloadCanvas` refreshes the multilist. SDK pinned to the spike's versions: `@sitecore-marketplace-sdk/client` ^0.5.1, `@sitecore-marketplace-sdk/xmc` ^0.6.0. The owner chose to continue with approach B.

**Files:**
- Create (throwaway branch `spike/field-context`): `src/app/custom-field-extension/page.tsx`
- Create (kept, on `main`): `docs/spike-findings.md`

**Interfaces:**
- Produces: `docs/spike-findings.md` answering each question below with the exact SDK key and response shape observed. Task 3 is written from it.

- [ ] **Step 1:** Scaffold from the Marketplace starter (or Content Transfer's `useMarketplaceClient` hook + layout). Register a local custom app in App Studio: extension point **Page builder custom field**, route `/custom-field-extension`, localhost URL.
- [ ] **Step 2:** In the page, after client init, log the result of: `client.getValue()`, `client.query('application.context')`, `client.query('pages.context')`, `client.query('field.context')` (may not exist; log the error), and subscribe to `pages.context`. Render the raw JSON on screen too.
- [ ] **Step 3:** In a test environment, add a plugin field (Source = app ID) to (a) a page template and (b) a component datasource template. Set a JSON string on each template's Standard Values. Open the field from Page content and from a component's Content tab.
- [ ] **Step 4:** With the `contextId` from `application.context`, run via `xmc.authoring.graphql`: read the current item's fields, `createItem` under a test folder, `updateItem` on another field of the current item. Record the exact input/return shapes that work.
- [ ] **Step 5:** After Step 4, check whether the native multilist shows the new value without reload; look for any SDK refresh/reload event or mutation.
- [ ] **Step 6:** Write `docs/spike-findings.md`: one row per question — item ID (page / datasource), language, version, Standard Values inherited by `getValue`, create + update as signed-in user, refresh. Include the working GraphQL for create, read field, update field.
- [ ] **Step 7:** **STOP and report to the user.** If the current item ID is not available for both page and datasource fields, do not continue: the design falls back to approach A and needs a new plan. Otherwise commit `docs/spike-findings.md` to `main` and delete the spike branch.

---

### Task 1: Project scaffold and SDK layer

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`, `components.json`, `.gitignore`, `LICENSE` (MIT) — copied from Content Transfer, `name` = `sitecore-multilist-item-creator`, drop `jszip`. SDK versions from Task 0 (client ^0.5.1, xmc ^0.6.0). `.gitignore` also ignores `/.superpowers/`.
- Create: `.github/workflows/ci.yml` — on push and pull request: Node 24, `npm ci`, `npm test`, `npm run build`.
- Create: `src/utils/hooks/useMarketplaceClient.ts` (copy; keep `modules: [XMC]`, timeout 60_000)
- Create: `src/lib/sdk.ts` — only `Env`, `SdkClient`, `SdkError`, `call`, `graphql`, `toEnvs` from Content Transfer
- Create: `src/test/fakeClient.ts` — only `fakeClient` and `FakeReply`
- Create: `src/components/ui/*` — only `button`, `input`, `label`, `select`, `alert`, `spinner`
- Test: `src/lib/sdk.test.ts` — the `call`, `graphql` and `toEnvs` cases from Content Transfer

**Interfaces:**
- Produces: `call<T>(client, env, kind, key, params)`, `graphql(client, env, query, variables): Promise<any>`, `SdkError(message, status?)`, `fakeClient(handlers) → { client, calls }` — same signatures as Content Transfer.

- [ ] **Step 1:** Copy files; `npm install`.
- [ ] **Step 2:** Run `npm test`. Expected: copied sdk tests PASS.
- [ ] **Step 3:** Run `npm run build`. Expected: build succeeds.
- [ ] **Step 4:** Commit `chore: scaffold from Content Transfer conventions`.

---

### Task 2: Config parsing

**Files:**
- Create: `src/lib/config.ts`
- Test: `src/lib/config.test.ts`

**Interfaces:**
- Produces:
  - `type CreatorConfig = { targetField: string; folder?: string; templates?: string[]; nameFrom?: string; required?: string[] }`
  - `type ConfigResult = { ok: true; config: CreatorConfig } | { ok: false; reason: 'empty' | 'invalid-json' | 'missing-target' | 'bad-guid' ; message: string }`
  - `parseConfig(raw: string | null | undefined): ConfigResult`
  - `normalizeId(id: string): string` — returns `{UPPERCASE-GUID}`; accepts dashed GUIDs with or without braces and the Authoring API's compact 32-hex form; throws `SdkError` on non-GUID.

`required` lists extra field names the create form asks for (spec: "any fields the config marks as required to create").

- [ ] **Step 1: Write failing tests**

```ts
expect(parseConfig('')).toMatchObject({ ok: false, reason: 'empty' });
expect(parseConfig('{nope')).toMatchObject({ ok: false, reason: 'invalid-json' });
expect(parseConfig('{"folder":"{…}"}')).toMatchObject({ ok: false, reason: 'missing-target' });
expect(parseConfig('{"targetField":"Related Items","folder":"abc"}')).toMatchObject({ ok: false, reason: 'bad-guid' });
expect(parseConfig('{"targetField":"Related Items"}')).toEqual({ ok: true, config: { targetField: 'Related Items' } });
expect(parseConfig('{"targetField":"X","folder":"1c0685bf-fbf9-447b-8fc9-6758ecae42cd"}'))
  .toEqual({ ok: true, config: { targetField: 'X', folder: '{1C0685BF-FBF9-447B-8FC9-6758ECAE42CD}' } });
expect(normalizeId('{1c0685bf-fbf9-447b-8fc9-6758ecae42cd}')).toBe('{1C0685BF-FBF9-447B-8FC9-6758ECAE42CD}');
expect(normalizeId('1c0685bffbf9447b8fc96758ecae42cd')).toBe('{1C0685BF-FBF9-447B-8FC9-6758ECAE42CD}');
expect(() => normalizeId('local:/Data/x')).toThrow();
```

- [ ] **Step 2:** `npx vitest run src/lib/config.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `parseConfig` and `normalizeId` in `src/lib/config.ts`. Normalize `folder` and every `templates` entry.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `feat: parse companion field config`.

---

### Task 3: Find the field's item (rewritten after the spike)

The SDK names the page, never the item or field that opened the app. So the app reads the page and every datasource in the page's layout, and keeps the ones holding a field whose value equals `getValue()`.

**Files:**
- Create: `src/lib/fieldContext.ts`
- Test: `src/lib/fieldContext.test.ts`

**Interfaces:**
- Consumes: `docs/spike-findings.md` (response shapes and the candidate query), `toEnvs`, `Env`, `graphql`, `SdkError`, `normalizeId`.
- Produces:
  - `type Candidate = { itemId: string; name: string; path: string; templateId: string; version?: number; fields: { name: string; value: string }[] }` (IDs normalized)
  - `type PageContext = { env: Env; language: string; rawConfig: string; candidates: Candidate[] }`
  - `type FieldContext = { env: Env; itemId: string; itemName: string; itemPath: string; templateId: string; language: string; version?: number; rawConfig: string }`
  - `readPage(client: SdkClient & { getValue(): Promise<unknown> }): Promise<PageContext>`
  - `matchByValue(candidates: Candidate[], raw: string): Candidate[]` — candidates with a field whose value equals `raw` exactly; `[]` when `raw` is blank (blank would match every empty field).
  - `matchByField(candidates: Candidate[], fieldName: string): Candidate[]` — candidates with a field of that name, case-insensitive. Setup uses it before a config exists.
  - `toFieldContext(page: PageContext, c: Candidate): FieldContext`

`readPage`:
1. `getValue()` → `rawConfig` (anything but a string → `''`).
2. `application.context` → `toEnvs`. Use the env whose `id` equals `host.state` → `xmCloudTenantInfo.id`; else the only env; else `SdkError("Couldn't tell which environment this page is in.")`.
3. `pages.context` → `pageInfo.id`, `pageInfo.path`, `pageInfo.language` (else `siteInfo.language`), and the `dataSource` of every rendering in `JSON.parse(pageInfo.presentationDetails).devices[].renderings[]`. No `pageInfo.id` → `SdkError("Couldn't tell which page this is.")`.
4. One aliased Authoring query (shape in the findings, plus `version`): the page first, then each distinct non-empty `dataSource` in layout order. A GUID (any form) is looked up by `itemId`; `local:/x` by path `<page path>/x`; `/sitecore/…` by path; anything else is skipped. Aliases that come back `null` are dropped.
5. A plain query (`application.context`, `pages.context`, `host.state`) that resolves with `isError` → `SdkError`. Never log or keep `siteInfo`: it can carry protection-bypass tokens.

- [ ] **Step 1: Write failing tests** with `fakeClient` (plus a `getValue` stub) and replies shaped like the findings: candidates are the page then the datasources in layout order, de-duplicated, `local:` resolved, compact IDs normalized; null aliases dropped; env picked by host tenant out of two; missing page ID → its message; `matchByValue` with one hit, two hits, and blank `raw` → `[]`; `matchByField` ignores case.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: find the field's item on the page`.

---

### Task 4: Resolve folder and allowed templates

**Files:**
- Create: `src/lib/targets.ts`
- Test: `src/lib/targets.test.ts`

**Interfaces:**
- Consumes: `graphql`, `CreatorConfig`, `FieldContext`.
- Produces:
  - `type Target = { folderId: string; folderPath: string; templates: { id: string; name: string }[] }`
  - `resolveTarget(client: SdkClient, ctx: FieldContext, config: CreatorConfig): Promise<Target>`

Resolution order (spec "fallback"):
1. `folder` = `config.folder`, else the target field's Source on the item's own template (`ctx.templateId`): find the template field item named `config.targetField` under the template's sections; parse its `Source` value as an ID or path; for a `StartSearchLocation={ID}` source, take that ID. Base templates are not searched.
2. `templates` = `config.templates`, else the folder's `__Masters` field (Insert Options), split on `|`.
3. Look up each template's name in one query.

Errors (all `SdkError`, shown as-is in the modal):
- target field not found on the template → `"Field \"<targetField>\" isn't on this item's template. Check targetField in Setup."`
- no folder resolvable → `"Set a folder in Setup: the field's Source doesn't point to one."`
- no templates → `"Set templates in Setup: the folder has no Insert Options."`

- [ ] **Step 1: Write failing tests** with a fake `xmc.authoring.graphql` handler: config folder + templates used as-is (names looked up); Source `{ID}` used when no config folder; Source `StartSearchLocation={ID}&TemplateFilter=…` → that ID; Source as a path → resolved to its ID; `__Masters` `"{A}|{B}"` → two templates; each of the three error messages.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with at most three GraphQL round trips (template fields, folder + `__Masters`, template names).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: resolve target folder and templates`.

---

### Task 5: Append to the target multilist

**Files:**
- Create: `src/lib/multilist.ts`
- Test: `src/lib/multilist.test.ts`

**Interfaces:**
- Consumes: `graphql`, `FieldContext`, `normalizeId`.
- Produces:
  - `appendId(value: string | null | undefined, id: string): { value: string; added: boolean }` (pure)
  - `addToMultilist(client: SdkClient, ctx: FieldContext, fieldName: string, id: string): Promise<{ added: boolean }>` — reads the field's current value for `ctx.itemId`/`language`/`version`, applies `appendId`, writes only if `added`.

- [ ] **Step 1: Write failing tests**

```ts
expect(appendId('', '{A}')).toEqual({ value: '{A}', added: true });
expect(appendId(null, '{A}')).toEqual({ value: '{A}', added: true });
expect(appendId('{B}', '{A}')).toEqual({ value: '{B}|{A}', added: true });
expect(appendId('{b}|{a}', '{A}')).toEqual({ value: '{b}|{a}', added: false });
expect(appendId('B|a', '{A}')).toEqual({ value: 'B|a', added: false });
```
(use real GUIDs in the file; letters shown for brevity). Plus `addToMultilist`: issues read then update with the appended value; issues no update when already present; the update targets the same language and version that were read.

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Keep existing entries exactly as stored; only the new ID is normalized.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: append new item to the target multilist`.

---

### Task 6: Create the item

**Files:**
- Create: `src/lib/create.ts`
- Test: `src/lib/create.test.ts`

**Interfaces:**
- Consumes: `graphql`, `Target`, `FieldContext`.
- Produces:
  - `validateItemName(name: string): string | null` — `null` when valid, else the message `"Names can't be empty or contain / \\ : ? \" < > | [ ] *"` or `"Names can't start or end with a space."`
  - `createItem(client: SdkClient, ctx: FieldContext, input: { name: string; templateId: string; folderId: string; fields: Record<string, string> }): Promise<{ id: string; path: string }>`

- [ ] **Step 1: Write failing tests:** each forbidden character, empty, leading/trailing space → message; valid name → `null`. `createItem` sends `createItem` with name, template, parent, `ctx.language` and the `fields` map, and returns the normalized ID + path; a GraphQL error surfaces as `SdkError` with Sitecore's message.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement using the create mutation recorded in the spike.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: create item through the authoring API`.

---

### Task 7: Creator modal (editor flow)

**Files:**
- Create: `src/components/creator/CreatorModal.tsx`, `src/components/creator/copy.ts`
- Create: `src/app/custom-field-extension/page.tsx`
- Test: `src/components/creator/CreatorModal.test.tsx`

**Interfaces:**
- Consumes: `readPage`, `matchByValue`, `toFieldContext`, `parseConfig`, `resolveTarget`, `createItem`, `validateItemName`, `addToMultilist`.
- Produces: `CreatorModal({ client }: { client: ClientSDK })`; `onOpenSetup` switches to Task 8's view.

States: loading → not-set-up (config `ok:false`; the lookup isn't run) → pick (several `matchByValue` hits: one button per item, name and path) → form (template select, name, one input per `config.required`, prefilled name from `nameFrom` field if typed) → working → done (`"Added <name> to <targetField>."`, plus `client.closeApp()` on Close) → error. No hit → error `"Couldn't find this field's item on the page. Components from partial designs aren't supported yet."`

After a successful append, call `client.mutate('pages.reloadCanvas')` so the multilist shows the new item. If that call fails, add `" Reload the page to see it in the list."` to the done message.

Copy (in `copy.ts`): not set up → `"This field isn't set up yet."` + button `"Open setup"`; pick → `"This field is on more than one component here. Which one?"`; partial failure → `"Created <path>, but couldn't add it to <targetField>. Select it there yourself."`

- [ ] **Step 1: Write failing tests** with a fake client: renders not-set-up for empty and invalid config (Review Focus 5); no match → the not-found message, nothing written; two matches → pick, and the chosen item is the one written (Review Focus 6); lists resolved templates; Create disabled while name is invalid and shows the Task 6 message; happy path calls create, then add, then `pages.reloadCanvas`, and shows the done message; append failure after create shows the partial-failure copy with the path and does not call create again (Review Focus 4); create failure shows the `SdkError` message.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement component and wire the page (client from `useMarketplaceClient`, error and loading states like Content Transfer's extension pages).
- [ ] **Step 4:** Run → PASS; `npm run build` succeeds.
- [ ] **Step 5:** Commit `feat: creator modal`.

---

### Task 8: Setup view

**Files:**
- Create: `src/components/creator/SetupView.tsx`, `src/lib/setup.ts`
- Test: `src/lib/setup.test.ts`, `src/components/creator/SetupView.test.tsx`

**Interfaces:**
- Consumes: `CreatorConfig`, `parseConfig`, `resolveTarget`, `PageContext`, `matchByField`, `toFieldContext`.
- Produces: `buildConfig(form: { targetField: string; folder?: string; templates?: string[]; nameFrom?: string; required?: string[] }): string` (pretty JSON, empty optionals omitted); `SetupView({ client, page, initial })`.

Setup can't use the value lookup: the config it builds isn't stored yet. **Check** takes the first candidate with a field named the form's `targetField` (`matchByField`) and says which item it checked; none → `"No item on this page has a field named <targetField>."`

Decision (spec left it to the builder): Setup **produces JSON to copy** and shows where to paste it (`"Paste this into the field's value on the template's Standard Values."`). It does not write Standard Values itself — keeps the app from editing templates.

Setup has **Check** which runs `resolveTarget` with the form's config against the current item and shows the folder path and template names, or the error.

- [ ] **Step 1: Write failing tests:** `buildConfig` omits empty optionals and round-trips through `parseConfig`; view prefills from an existing config; Check shows resolved folder path and template names; Check shows a `resolveTarget` error; Copy puts the JSON on the clipboard.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: setup view`.

---

### Task 9: README and end-to-end check

**Files:**
- Create: `README.md`, `public/logo.svg`

- [ ] **Step 1:** README in Content Transfer's style: what it does (one paragraph), install (App Studio registration, extension point, route), set up a field (template field type "Marketplace Type -> Plugin", Source = app ID, Standard Values JSON with the config table), the fallback rules, limitations (components from partial designs not found, several same-type components ask the editor to pick, base templates not searched, workflow not touched).
- [ ] **Step 2:** Manual end-to-end on a test environment, both page and datasource fields: create with full config; create with only `targetField`; already-selected guard; non-default language; user without create rights sees Sitecore's message. Record results in `docs/e2e-2026-11.md`.
- [ ] **Step 3:** `npm test` and `npm run build` pass.
- [ ] **Step 4:** Commit `docs: readme and e2e results`.
