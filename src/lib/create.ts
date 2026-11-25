import { normalizeId } from './config';
import type { FieldContext } from './fieldContext';
import { SdkError, graphql, type SdkClient } from './sdk';

const BAD_NAME = 'Names can\'t be empty or contain / \\ : ? " < > | [ ] *';
const BAD_SPACE = "Names can't start or end with a space.";

/** `null` when `name` can be used as an item name, else the message to show the editor. */
export function validateItemName(name: string): string | null {
  if (!name.trim() || /[/\\:?"<>|[\]*]/.test(name)) return BAD_NAME;
  return name !== name.trim() ? BAD_SPACE : null;
}

// The fields go in as literals (JSON string escaping is valid GraphQL string syntax): the input type's name for a variable isn't verified live.
const createItemDocument = (fields: Record<string, string>) => {
  const list = Object.entries(fields).map(([name, value]) => `{ name: ${JSON.stringify(name)}, value: ${JSON.stringify(value)} }`);
  return `mutation CreateItem($name: String!, $templateId: ID!, $parent: ID!, $language: String!) {
  createItem(input: { name: $name, templateId: $templateId, parent: $parent, language: $language${list.length ? `, fields: [${list.join(', ')}]` : ''} }) {
    item { itemId name path }
  }
}`;
};

/** Creates the item under `folderId`. Never retries: a second attempt could create a duplicate. Sitecore's error reaches the caller as an `SdkError`. */
export async function createItem(
  client: SdkClient,
  ctx: FieldContext,
  input: { name: string; templateId: string; folderId: string; fields: Record<string, string> },
): Promise<{ id: string; path: string }> {
  const data = await graphql(client, ctx.env, createItemDocument(input.fields), {
    name: input.name,
    templateId: input.templateId,
    parent: input.folderId,
    language: ctx.language,
  });
  const item = data?.createItem?.item;
  if (!item?.itemId) throw new SdkError("Sitecore didn't confirm the new item. Check the folder before trying again.");
  return { id: normalizeId(item.itemId), path: item.path };
}
