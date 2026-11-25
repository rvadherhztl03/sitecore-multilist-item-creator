# Multilist Item Creator — Marketplace App Design

Nov 25, 2026 · @Ravi Vadher

## Intent and why

Editors in the SitecoreAI Page builder can select and deselect existing items in a multilist, but cannot create a new item from there. Today they leave the Page builder, create the item in the Content Editor under the field's source, come back and select it.

This app removes that round trip. It is a public Marketplace app, so any SitecoreAI customer can install it and fix the gap without changing their content model or frontend.

The app adds a small companion field next to an existing multilist. From it, an editor creates a new item and the app appends that item to the real multilist field. The native Multilist keeps doing everything it already does.

## Goals, non-goals, anti-goals

**Goals**

- An editor can create a new item for a multilist without leaving the Page builder.
- The new item lands in the right folder, on the right template, and is selected in the multilist in one action.
- A team adopts it by installing the app and adding one field per multilist. No code, content or frontend changes.
- Works for both page fields and component datasource fields.

**Non-goals**

- Replacing the Page builder's own selection, search or reordering of multilist items.
- Editing the new item's fields beyond what is needed to create it. Editors finish it in the Page builder as usual.
- Supporting single-item reference fields (Droplink, Droptree) in the first version.

**Anti-goals** (failure even if it technically works)

- Changing the multilist's field type or how its value is stored.
- Storing customer credentials or API keys in the app. All access goes through the Marketplace SDK inside SitecoreAI.
- Silently overwriting selections an editor made in the native field.

## Constraints

These come from how the Marketplace custom field extension point works today.

- **The field is a plugin field, not a new field type.** It is added to a data template with type "Marketplace Type -> Plugin" and the app ID in the Source column ([enable a custom field](https://doc.sitecore.com/mp/en/developers/marketplace/enable-a-custom-field-in-the-sitecoreai-page-builder.html)). So per-field settings such as target folder and template cannot go in Source.
- **The app opens in a modal.** The editor clicks Open app on the field; the app runs in that modal and closes itself ([extension points](https://doc.sitecore.com/mp/en/developers/marketplace/extension-points.html)).
- **The documented SDK surface is the field's own value.** The docs show getting and setting the custom field's value ([get and set values](https://doc.sitecore.com/mp/en/developers/sdk/0/sitecore-marketplace-sdk/get-and-set-custom-field-values.html)). Whether the app also learns the current item, page, language and field name is not documented. The spike settles this.
- **Creating items and writing the multilist need the Authoring API.** The app calls it through the SDK's SitecoreAI APIs, so permissions come from the signed-in user inside SitecoreAI.
- **The Page builder caches what it shows.** After the app writes the multilist through the API, the native field may not show the new selection until refresh.
- **Local development works in place.** The app can be registered against localhost and debugged inside the Page builder with live data ([Marketplace starter](https://github.com/Sitecore/marketplace-starter)).

## Approaches

We chose **B, the companion field**, because adoption by other teams matters more than a single-field experience.

|  | A. Replacement field | B. Companion field (chosen) |
| --- | --- | --- |
| What it is | Plugin field stores the selected IDs and handles select, search, reorder and create | Native Multilist stays; a plugin field beside it creates items and appends them to the multilist |
| Content model change | Field type changes on every adopting template | One extra field per multilist |
| Frontend change | Edge and Layout Service return a raw string; components must resolve IDs | None |
| Existing content | Needs migration | Untouched |
| If the app is down | Field cannot be edited | Editors lose only the create shortcut |
| Editor experience | One field, seamless | Two fields; new selection may need a refresh |
| Main dependency | Only the documented get/set value | SDK must expose the current item (spike) |

A stays the fallback if the spike shows B cannot know which item it is on.

## Design

The companion field holds its own configuration, and the editor flow only ever writes to the target multilist.

### Setting it up (developer, once per multilist)

1. Install the app and enable the Page builder custom field extension point.
2. On the template that has the multilist, add a field of type "Marketplace Type -> Plugin", Source = the app ID. Name it for editors, for example "Add new related item".
3. On that template's Standard Values, set the companion field's value to a small JSON config. Every item inherits it, so editors never see or change it.
4. The app has a Setup view that builds this JSON from a form and validates it, so nobody hand-writes it.

The config names the target multilist field and, optionally, the folder to create in, the allowed templates and a naming rule:

```json
{
  "targetField": "Related Items",
  "folder": "{GUID of the folder}",
  "templates": ["{GUID of an allowed template}"],
  "nameFrom": "Title"
}
```

If `folder` or `templates` is missing, the app falls back to the target multilist's own Source (its root) and that folder's Insert Options. A team can start with only `targetField`.

### Editor flow

1. Editor clicks Open app on the companion field, in Page content or a component's Content tab.
2. The app reads its config and the current item, language and version from the SDK.
3. It shows the allowed templates, a name box and any fields the config marks as required to create (for example Title).
4. On Create, it creates the item in the target folder, in the current language, through the Authoring API.
5. It re-reads the target multilist's current value, appends the new ID if not already present, and saves the field. It never replaces the existing selection.
6. It closes and tells the editor the item was added. If the SDK offers a refresh event, it triggers one; otherwise the message says to reload to see it in the list.

### Errors and edge cases

- **No create rights** on the folder: show who can fix it; create nothing.
- **Item creation succeeds but the field update fails**: say so and show the new item's path so it can be selected by hand.
- **Config invalid or target field missing**: show the problem in the modal, with a link to Setup.
- **Workflow**: the new item enters its template's default workflow like any other new item. The app does not approve or publish it.
- **Shared vs versioned multilist**: write the field in the language and version the editor is on; if the field is shared, a single write covers all.

## Step 0: the spike

Before building, spend about half a day proving the SDK gives B what it needs. It is throwaway code.

Register a local app from the Marketplace starter with only the custom field extension point. Add a plugin field to a test page template and a test datasource template. Open it from both places and log every query and event the client exposes.

| Question | Pass looks like |
| --- | --- |
| Does the app learn the current item ID? | Item ID available for both a page and a component datasource |
| Does it learn language and version? | Both available, or derivable from page context |
| Does getValue return the inherited Standard Values config? | The JSON from Standard Values comes back on a normal item |
| Can it create an item and update another field through the Authoring API? | Both succeed as the signed-in user, no stored credentials |
| Does the native multilist pick up the change? | Shows on reload, or through an SDK refresh event |

**Decision rule**: if the item ID question fails, stop B and plan A. If only the refresh question fails, keep B and rely on the reload message.

## Calls made and open questions

**Calls made in this design** (check these)

- Config lives in the companion field's own value on Standard Values, so it travels with the template and needs no settings items.
- The editor flow never calls setValue on the companion field, only on the target multilist, so config cannot be overwritten by editors.
- Folder and templates fall back to the multilist's Source and Insert Options, so the minimum config is one line.
- Built on the Sitecore Marketplace starter (Next.js), the same base as the other Marketplace apps.
- "Multilist Item Creator" is a working name only.

**Left to the builder**

- Modal layout and copy, the Setup view's form, and logging.
- Whether Setup writes Standard Values through the API or produces JSON to paste.

**Open questions**

- [ ] Final app name for the listing.
- [ ] Ship first as a custom app for PSP or West Pharma, or go straight to a public listing?
- [ ] Is Droplink/Droptree support worth a second version?
