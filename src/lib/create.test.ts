// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createItem, validateItemName } from '@/lib/create';
import { SdkError } from '@/lib/sdk';
import type { FieldContext } from '@/lib/fieldContext';
import { fakeClient } from '@/test/fakeClient';

const BAD_NAME = 'Names can\'t be empty or contain / \\ : ? " < > | [ ] *';
const BAD_SPACE = "Names can't start or end with a space.";

const CTX: FieldContext = {
  env: { id: 'e1', name: 'Dev', contextId: 'p1' },
  itemId: '{11111111-1111-1111-1111-111111111111}',
  itemName: 'Hero',
  itemPath: '/sitecore/content/Home/Data/Hero',
  templateId: '{22222222-2222-2222-2222-222222222222}',
  language: 'en',
  rawConfig: '{"targetField":"items"}',
};
const INPUT = {
  name: 'New article',
  templateId: '{33333333-3333-3333-3333-333333333333}',
  folderId: '{44444444-4444-4444-4444-444444444444}',
  fields: { Title: 'New article', Author: 'Ana' },
};
const CREATED = { data: { data: { createItem: { item: { itemId: '1c0685bffbf9447b8fc96758ecae42cd', name: 'New article', path: '/sitecore/content/Home/Articles/New article' } } } } };

describe('validateItemName', () => {
  it.each(['/', '\\', ':', '?', '"', '<', '>', '|', '[', ']', '*'])('rejects %s', (ch) => {
    expect(validateItemName(`a${ch}b`)).toBe(BAD_NAME);
  });
  it('rejects an empty name and a name of only spaces', () => {
    expect(validateItemName('')).toBe(BAD_NAME);
    expect(validateItemName('   ')).toBe(BAD_NAME);
  });
  it('rejects a leading or trailing space', () => {
    expect(validateItemName(' a')).toBe(BAD_SPACE);
    expect(validateItemName('a ')).toBe(BAD_SPACE);
  });
  it('reports a forbidden character before the spacing rule', () => {
    expect(validateItemName(' a/b ')).toBe(BAD_NAME);
  });
  it('accepts a valid name', () => {
    expect(validateItemName('New article')).toBeNull();
    expect(validateItemName('News-2026_final (v2)')).toBeNull();
  });
});

describe('createItem', () => {
  it('sends name, template, parent and language as variables, and returns the normalized ID and path', async () => {
    const { client, calls } = fakeClient({ 'xmc.authoring.graphql': () => CREATED });
    const result = await createItem(client, CTX, INPUT);
    expect(result).toEqual({ id: '{1C0685BF-FBF9-447B-8FC9-6758ECAE42CD}', path: '/sitecore/content/Home/Articles/New article' });
    expect(calls).toHaveLength(1);
    const { query, variables } = calls[0].params.body;
    expect(query).toContain('createItem');
    expect(variables).toEqual({
      name: 'New article',
      templateId: INPUT.templateId,
      parent: INPUT.folderId,
      language: 'en',
    });
    expect(calls[0].params.query.sitecoreContextId).toBe('p1');
  });
  it('writes the fields into the document as literals, not as a variable', async () => {
    const { client, calls } = fakeClient({ 'xmc.authoring.graphql': () => CREATED });
    await createItem(client, CTX, INPUT);
    const { query, variables } = calls[0].params.body;
    expect(query).toContain('fields: [{ name: "Title", value: "New article" }, { name: "Author", value: "Ana" }]');
    expect(query).not.toContain('$fields');
    expect(query).not.toContain('FieldValueInput');
    expect(variables).not.toHaveProperty('fields');
  });
  it('escapes quotes, backslashes and newlines in a field value as GraphQL string syntax', async () => {
    const { client, calls } = fakeClient({ 'xmc.authoring.graphql': () => CREATED });
    await createItem(client, CTX, { ...INPUT, fields: { Text: 'He said "hi" in C:\\dir\nnext line' } });
    expect(calls[0].params.body.query).toContain(String.raw`fields: [{ name: "Text", value: "He said \"hi\" in C:\\dir\nnext line" }]`);
  });
  it('leaves fields out of the document when there are none', async () => {
    const { client, calls } = fakeClient({ 'xmc.authoring.graphql': () => CREATED });
    await createItem(client, CTX, { ...INPUT, fields: {} });
    expect(calls[0].params.body.query).not.toContain('fields');
  });
  it.each([
    ['createItem is null', { createItem: null }],
    ['item is null', { createItem: { item: null } }],
    ['item has no itemId', { createItem: { item: { name: 'New article', path: '/x' } } }],
    ['the reply has no data', null],
  ])("says Sitecore didn't confirm the item when %s", async (_why, data) => {
    const { client, calls } = fakeClient({ 'xmc.authoring.graphql': () => ({ data: { data } }) });
    const err = await createItem(client, CTX, INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(SdkError);
    expect(err.message).toBe("Sitecore didn't confirm the new item. Check the folder before trying again.");
    expect(calls).toHaveLength(1);
  });
  it("surfaces Sitecore's error message as an SdkError, without retrying", async () => {
    const { client, calls } = fakeClient({ 'xmc.authoring.graphql': () => ({ data: { errors: [{ message: 'Item already exists: New article' }] } }) });
    const err = await createItem(client, CTX, INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(SdkError);
    expect(err.message).toBe('Item already exists: New article');
    expect(calls).toHaveLength(1);
  });
});
