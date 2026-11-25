import { normalizeId } from './config';
import type { FieldContext } from './fieldContext';
import { graphql, type SdkClient } from './sdk';

const BAD_NAME = 'Names can\'t be empty or contain / \\ : ? " < > | [ ] *';
const BAD_SPACE = "Names can't start or end with a space.";

/** `null` when `name` can be used as an item name, else the message to show the editor. */
export function validateItemName(name: string): string | null {
  if (!name.trim() || /[/\\:?"<>|[\]*]/.test(name)) return BAD_NAME;
  return name !== name.trim() ? BAD_SPACE : null;
}

const CREATE_ITEM = `mutation CreateItem($name: String!, $templateId: ID!, $parent: ID!, $language: String!, $fields: [FieldValueInput!]) {
  createItem(input: { name: $name, templateId: $templateId, parent: $parent, language: $language, fields: $fields }) {
    item { itemId name path }
  }
}`;

/** Creates the item under `folderId`. Never retries: a second attempt could create a duplicate. Sitecore's error reaches the caller as an `SdkError`. */
export async function createItem(
  client: SdkClient,
  ctx: FieldContext,
  input: { name: string; templateId: string; folderId: string; fields: Record<string, string> },
): Promise<{ id: string; path: string }> {
  const data = await graphql(client, ctx.env, CREATE_ITEM, {
    name: input.name,
    templateId: input.templateId,
    parent: input.folderId,
    language: ctx.language,
    fields: Object.entries(input.fields).map(([name, value]) => ({ name, value })),
  });
  const item = data.createItem.item;
  return { id: normalizeId(item.itemId), path: item.path };
}
