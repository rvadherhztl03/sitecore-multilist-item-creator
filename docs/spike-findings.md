# Spike findings: what the Page builder custom field exposes

Task 0 of the plan, run on 2026-11-25 in a SitecoreAI test environment (SXA headless site) with `@sitecore-marketplace-sdk/client` 0.5.1 and `@sitecore-marketplace-sdk/xmc` 0.6.0. The app was a custom app on `http://localhost:3000`, route `/custom-field-extension`, extension point "SitecoreAI Page Builder custom field". The plugin field was added to a component's datasource template, with `{"targetField":"items"}` on its Standard Values. Customer names, IDs and hosts are replaced with placeholders.

## Answers

| Question | Result | How |
|---|---|---|
| Item ID, page field | Available | `pages.context` → `pageInfo.id`. Not opened from a page-level field in this run (the page template had no plugin field). The lookup below covers it too: the page is its first candidate. |
| Item ID, datasource field | **Not given by the SDK. Derived.** | The host only describes the page. The app reads the page and every `dataSource` in `pageInfo.presentationDetails` in one aliased Authoring query, and picks the item with a field whose value equals `getValue()`. It found the right item, 1 of 9 candidates. |
| Field name | Not given | The same lookup returns the matching field's name. |
| Language | Available | `pageInfo.language` (`en`). `siteInfo.language` is the site default. |
| Version | Page: `pageInfo.version`. Datasource: not given | Reading the item returns `version`. `updateItem` without `version` wrote the latest (1). |
| `getValue()` returns the Standard Values config | Yes | The raw string `{"targetField":"items"}`, nothing wrapped around it. |
| Create and update as the signed-in user | Yes | `xmc.authoring.graphql` through the SDK, HTTP 200, no credentials. |
| Native multilist shows the change | Yes, after `pages.reloadCanvas` | `client.mutate('pages.reloadCanvas')` showed the new item in the field without a browser reload. |

## Other SDK facts

- There is no `field.context` query: "No schema available for key: field.context:query".
- `site.context` fails in the Page builder: "getSiteContext method is not implemented."
- `host.route` returns no data. `application.urlState` returns `{ state: null }`. `host.state` returns tenant info and the user's claims.
- The iframe URL carries only `organizationId` and `marketplaceAppTenantId`. The host sends nothing unprompted: only the handshake and replies.
- `application.context`: extension point `xmc:pages:customfield` with `display: "popup"`; `resourceAccess` entries with `context.preview` and `context.live`, the shape Content Transfer's `toEnvs` already reads.
- `query()` doesn't throw on failure: it resolves `{ status: "error", isError: true, error: { code: "EXECUTION_ERROR" } }`. Content Transfer's `call` already handles this.
- `pages.context` includes the rendering host URLs with any protection-bypass token in their query string. Never log or store `siteInfo`.

## ID formats

- The Authoring API returns `itemId` and `templateId` as 32 lowercase hex characters, no dashes or braces: `1c0685bffbf9447b8fc96758ecae42cd`.
- Layout `dataSource` values come as `{UPPER-DASHED}` and as bare `lower-dashed`.
- Multilist values are stored as `{UPPER-DASHED}|{UPPER-DASHED}`. The spike appended a compact ID as-is; Sitecore still showed it, but the app must write the braced uppercase form.
- `item(where: { itemId })` accepts all three forms.

So `normalizeId` (Task 2) must accept the 32-hex form as well as dashed GUIDs with or without braces.

## Working GraphQL (through `xmc.authoring.graphql`)

Read an item and its fields:

```graphql
query ReadItem($itemId: ID!, $language: String!) {
  item(where: { database: "master", itemId: $itemId, language: $language }) {
    itemId name path version
    template { templateId name }
    fields(ownFields: false, excludeStandardFields: true) { nodes { name value } }
  }
}
```

Create an item:

```graphql
mutation CreateItem($name: String!, $templateId: ID!, $parent: ID!, $language: String!) {
  createItem(input: { name: $name, templateId: $templateId, parent: $parent, language: $language }) {
    item { itemId name path }
  }
}
```

Update one field:

```graphql
mutation UpdateField($itemId: ID!, $language: String!, $version: Int, $field: String!, $value: String!) {
  updateItem(input: { itemId: $itemId, language: $language, version: $version, fields: [{ name: $field, value: $value }] }) {
    item { itemId name path version }
  }
}
```

Find the field's item: one query, one alias per candidate (the page, then each layout `dataSource`; a `local:` source is resolved against the page path):

```graphql
query {
  i0: item(where: { database: "master", language: "en", itemId: "<page id>" }) { itemId name path template { templateId name } fields(ownFields: false, excludeStandardFields: true) { nodes { name value } } }
  i1: item(where: { database: "master", language: "en", itemId: "<datasource id>" }) { ... }
}
```

Variables go in the request body (`{ query, variables }`) with `sitecoreContextId` = the env's preview context.

## Observations

- The created item's fields were empty, because create sends no values. This is expected (editors finish the item in the Page builder), and it's why the config's `required` fields matter.
- The spike's hand-picked parent and template put the test item under `/sitecore/templates`. The app's fallback (the multilist's Source and the folder's Insert Options) is what prevents this.

## Limits of the derived datasource ID

- **Ambiguous:** two or more items on the page whose fields hold the same value (same template, inherited config) all match. The app must ask the editor to pick one, by item name and path.
- **Partial designs:** components that come from SXA partial designs aren't in the page's `presentationDetails`, so the lookup won't find their datasources. Reading the partial designs could extend it (untested).
- `presentationDetails` was the FINAL layout; a SHARED-only layout is untested.
- A per-item override of the companion field's value still matches, since `getValue()` returns that item's value.

## Decision

The plan's rule is to stop if the item can't be identified for both page and datasource fields. Page fields: the page ID is given. Datasource fields: the SDK doesn't give it, but the lookup above finds it, with the limits listed. Continuing with approach B needs Task 3 (`getFieldContext`) rewritten around this lookup and an editor pick when it is ambiguous. That change is waiting on the owner's decision.
