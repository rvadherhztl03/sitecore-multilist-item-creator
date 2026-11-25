# Multilist Item Creator

A **Sitecore Marketplace app** for the SitecoreAI Page builder. Editors create a new item for a multilist field without leaving the page. Built with Next.js 15 and the Sitecore Marketplace SDK.

---

## What it does

In the Page builder, editors can select and deselect existing items in a multilist, but they can't create one. They have to leave, create the item in the Content Editor, come back and select it.

This app adds a small companion field next to the multilist. The editor clicks **Open app**, names the new item, and the app creates it and adds it to the multilist. The native Multilist keeps working as before. Each multilist needs one extra field on its template. There is no other content model change and no frontend change.

---

## Install

1. In Sitecore Cloud Portal, open **App studio** and register a custom app. When the public listing is live, install that instead.
2. Add the extension point **SitecoreAI Page Builder custom field** with the route `/custom-field-extension`.
3. Give the app API access to the **SitecoreAI (XM Cloud) APIs**.
4. Give it the **clipboard** permission. The **Copy setup** button in Setup uses it. Without it, Setup shows the JSON so you can copy it by hand.
5. Install the app and grant it access to the environments it should work in.

---

## Set up a field

A developer does this once per multilist.

1. On the template that has the multilist, add a field of type **Marketplace Types > Plugin**. Use the page template, or the component's datasource template.
2. Set its **Source** to the app's Marketplace app ID.
3. Name the field for editors, for example `Add new related item`.
4. Put the JSON setup in the field's value on the template's **Standard Values**. Every item inherits it, so editors never see or change it.

The setup is a JSON object:

| Key | Type | Meaning | Example |
|---|---|---|---|
| `targetField` | text, required | The multilist field to add new items to. The case doesn't matter. | `"Related Items"` |
| `folder` | item ID | The folder new items are created in. If left out, the multilist's Source is used. | `"{3B0E2F6A-1C57-4B7D-9A52-6E8D1F4C0A91}"` |
| `templates` | list of item IDs | The templates the editor can choose from. If left out, the folder's Insert Options are used. | `["{7C1D9E40-52AB-4F0E-8B36-A2D5E7F91B63}"]` |
| `nameFrom` | text | The name of one of the `required` fields. The item's name follows what the editor types there, until the editor types a name. | `"Title"` |
| `required` | list of text | Fields the form asks for when creating, one text box each. Values are saved with the new item. Blank boxes are skipped. | `["Title"]` |

An item ID can be written as `{GUID}`, as a plain GUID, or as 32 hex digits.

```json
{
  "targetField": "Related Items",
  "folder": "{3B0E2F6A-1C57-4B7D-9A52-6E8D1F4C0A91}",
  "templates": ["{7C1D9E40-52AB-4F0E-8B36-A2D5E7F91B63}"],
  "nameFrom": "Title",
  "required": ["Title"]
}
```

### Build the setup in the Setup view

Nobody needs to write the JSON by hand.

1. Open a page that holds the field's item: the page itself, or a page with the component that uses the datasource template.
2. Open the app from the field. While the field has no setup, it says "This field isn't set up yet." Click **Open setup**.
3. Fill in the form. **Multilist field to add to** is the only required box. The folder, templates, name and required fields are optional.
4. Click **Check**. The app finds the field's item on the page and shows the folder and templates that new items will use.
5. Click **Copy setup**, then paste it into the field's value on the template's Standard Values and save.

Setup never writes to Sitecore. **Back** returns to the creator.

---

## Fallback rules

The minimum setup is one line:

```json
{ "targetField": "Related Items" }
```

- **Folder:** `folder`, if set. Otherwise the Source of the target field on the item's own template. The Source can be an item ID, a `/sitecore/...` path, or a `StartSearchLocation=` or `DataSource=` parameter. Any other Source, such as a query, isn't read. The app then says "Set a folder in Setup: the field's Source doesn't point to one."
- **Templates:** `templates`, if set. Otherwise the folder's Insert Options. If there are none, the app says "Set templates in Setup: the folder has no Insert Options."

---

## What editors see

1. In the Page builder, click **Open app** on the companion field. It sits in Page content, or in the component's Content tab.
2. If several components of the same type on the page have the field, the app asks "This field is on more than one component here. Which one?" The editor picks one by name and path.
3. The form says where new items go (`New items are created in <folder path>.`). The editor chooses a **Template** (preselected when there is only one) and types a **Name**. There is also a box for each field in `required`.
4. The editor clicks **Create**. The item is created in that folder, in the page's current language.
5. The app reads the multilist again and adds the new item to it. It never replaces the existing selection, and it doesn't add an item twice.
6. The canvas reloads, so the list shows the new item. The app says `Added <name> to <field>.`

Some things can go differently:

- Names can't be empty or contain `/ \ : ? " < > | [ ] *`, and can't start or end with a space.
- If Sitecore refuses to create the item, for example without create rights, the form shows the error and creates nothing.
- If the item is created but can't be added, the app says `Created <path>, but couldn't add it to <field>. Select it there yourself.` The editor selects it by hand.
- If the canvas can't reload, the message adds "Reload the page to see it in the list."
- If the app can't find the field's item, it says "Couldn't find this field's item on the page. Components from partial designs aren't supported yet."

New items start in their template's default workflow and aren't published.

---

## Limitations

- Components from SXA partial designs aren't found. Their datasources aren't in the page's layout.
- Base templates aren't searched for the target field's Source. If the multilist comes from a base template, set `folder`.
- Workflow isn't touched. The app doesn't approve or publish anything.
- Droplink and Droptree fields aren't supported. Only multilists are.
- `required` is a list of boxes to fill in, not a check. The editor can leave them blank.
- Untested: pages that only have a shared layout.

---

## Develop

```sh
npm install
npm run dev
npm test
npm run build
```

Register `http://localhost:3000` as the app's deployment URL in App studio, with the extension point above. The route only works when Sitecore opens it, not in a browser tab on its own.

---

## How it works

Everything runs in the browser through the Marketplace SDK, as the signed-in user:

- `getValue` reads the field's setup JSON.
- `pages.context` gives the page, its language and its layout. The SDK doesn't say which item or field opened the app.
- One Authoring GraphQL query reads the page and every datasource in its layout. The field's item is the one with a field whose value equals the setup JSON. If several match, the editor picks.
- `xmc.authoring.graphql` creates the item, reads the target field and updates it. Items are read and written in the `master` database.
- `pages.reloadCanvas` refreshes the page so the native field shows the new selection.

If the app has access to several environments, it uses the one the page is in. There are no server routes, secrets or stored credentials.

---

## License

MIT. See [LICENSE](LICENSE).
