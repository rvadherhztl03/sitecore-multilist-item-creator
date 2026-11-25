/* eslint-disable @typescript-eslint/no-explicit-any */
import { CreatorModal } from '@/components/creator/CreatorModal';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ARTICLE, BLOG, FOLDER, FOLDER_PATH, HERO, NEW_ITEM, TEASER, braced, compact, creatorFake, gqlError, item, type Item } from '@/test/creatorFake';

afterEach(cleanup);

const NOT_FOUND = "Couldn't find this field's item on the page. Components from partial designs aren't supported yet.";
const NAME_MESSAGE = 'Names can\'t be empty or contain / \\ : ? " < > | [ ] *';
const NEW_PATH = (name: string) => `/sitecore/content/Site/Data/Articles/${name}`;

const config = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ targetField: 'Related Items', folder: braced(FOLDER), templates: [braced(ARTICLE)], ...extra });
const RAW = config();
// An item that holds the companion field with this config, so matchByValue finds it.
const holder = (id: string, name: string, raw = RAW): Item => item(id, name, [{ name: 'Add related item', value: raw }, { name: 'Related Items', value: '' }]);
const other = item(TEASER, 'Teaser', [{ name: 'Add related item', value: '{"targetField":"other"}' }]);

type Fake = ReturnType<typeof creatorFake>;
async function open(fake: Fake) {
  render(<CreatorModal client={fake.client} />);
  await screen.findByRole('button', { name: 'Create' });
}
const writes = (fake: Fake) => fake.names().filter((n) => n === 'CreateItem' || n === 'UpdateField');
const typeName = (value: string) => fireEvent.change(screen.getByLabelText('Name'), { target: { value } });
const create = () => fireEvent.click(screen.getByRole('button', { name: 'Create' }));
function choose(label: string, option: string) {
  fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('CreatorModal: not set up', () => {
  it.each([
    ['empty', '', 'This field has no setup yet. Open Setup to create one.'],
    ['no value at all', null, 'This field has no setup yet. Open Setup to create one.'],
    ['invalid JSON', '{nope', "The setup isn't valid JSON. Open Setup to fix it."],
    ['no targetField', '{"folder":"x"}', 'The setup does not name the multilist to add to. Set "targetField".'],
  ])('says so for %s config, shows the config message, and goes no further', async (_why, raw, message) => {
    const fake = creatorFake({ raw, items: [holder(HERO, 'Hero')] });
    render(<CreatorModal client={fake.client} />);

    expect(await screen.findByText("This field isn't set up yet.")).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open setup' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
    // The page was read, but no target was resolved and nothing was written.
    expect(fake.names()).not.toContain('ReadFolder');
    expect(writes(fake)).toEqual([]);
  });
});

describe('CreatorModal: finding the field', () => {
  it('says the item was not found when no item holds the config, and writes nothing', async () => {
    const fake = creatorFake({ raw: RAW, items: [other] });
    render(<CreatorModal client={fake.client} />);

    expect(await screen.findByText(NOT_FOUND)).toBeInTheDocument();
    expect(fake.names()).not.toContain('ReadFolder');
    expect(writes(fake)).toEqual([]);
    expect(fake.client.setValue).not.toHaveBeenCalled();
  });

  it('shows the SDK error when the page cannot be read', async () => {
    const fake = creatorFake({ raw: RAW, ops: { ReadPage: () => gqlError('Sitecore is down') } });
    render(<CreatorModal client={fake.client} />);
    expect(await screen.findByText('Sitecore is down')).toBeInTheDocument();
  });

  it('never shows siteInfo', async () => {
    const fake = creatorFake({ raw: RAW, items: [holder(HERO, 'Hero')] });
    await open(fake);
    expect(document.body.textContent).not.toContain('SECRET-TOKEN');
  });

  it('asks which one when two items match, and writes to the one chosen', async () => {
    const fake = creatorFake({ raw: RAW, items: [holder(HERO, 'Hero'), other, holder(TEASER.replace('c49b', 'c49c'), 'Banner')] });
    render(<CreatorModal client={fake.client} />);

    expect(await screen.findByText('This field is on more than one component here. Which one?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hero/ })).toHaveTextContent('/sitecore/content/Site/Home/Data/Hero');
    expect(screen.getByRole('button', { name: /Banner/ })).toHaveTextContent('/sitecore/content/Site/Home/Data/Banner');
    expect(screen.queryByRole('button', { name: /Teaser/ })).not.toBeInTheDocument();
    expect(fake.names()).not.toContain('ReadFolder'); // nothing resolved until one is chosen

    fireEvent.click(screen.getByRole('button', { name: /Banner/ }));
    await screen.findByRole('button', { name: 'Create' });
    typeName('Fresh');
    create();
    await screen.findByText('Added Fresh to Related Items.');

    // The item that was read and written is the chosen one, not the first match.
    const bannerId = braced(TEASER.replace('c49b', 'c49c'));
    expect(fake.varsOf('ReadField')[0].itemId).toBe(bannerId);
    expect(fake.varsOf('UpdateField')[0].itemId).toBe(bannerId);
  });

  it('shows the resolve error with a way to Setup when the folder cannot be resolved', async () => {
    const fake = creatorFake({ raw: RAW, items: [holder(HERO, 'Hero')], ops: { ReadFolder: () => ({ data: { data: { item: null } } }) } });
    render(<CreatorModal client={fake.client} />);
    expect(await screen.findByText(`Folder ${braced(FOLDER)} wasn't found. Check folder in Setup.`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open setup' })).toBeInTheDocument();
    expect(writes(fake)).toEqual([]);
  });
});

describe('CreatorModal: the form', () => {
  it('preselects the only template and says where the item will be created', async () => {
    const fake = creatorFake({ raw: RAW, items: [holder(HERO, 'Hero')] });
    await open(fake);
    expect(screen.getByLabelText('Template')).toHaveTextContent('Article');
    expect(screen.getByText(FOLDER_PATH, { exact: false })).toBeInTheDocument();
  });

  it('lists the resolved templates and keeps Create disabled until one is chosen', async () => {
    const fake = creatorFake({ raw: config({ templates: [braced(ARTICLE), braced(BLOG)] }), items: [holder(HERO, 'Hero', config({ templates: [braced(ARTICLE), braced(BLOG)] }))] });
    await open(fake);
    typeName('Fresh');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

    fireEvent.keyDown(screen.getByLabelText('Template'), { key: 'Enter' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Article', 'Blog post']);
    fireEvent.click(screen.getByRole('option', { name: 'Blog post' }));
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();

    create();
    await screen.findByText('Added Fresh to Related Items.');
    expect(fake.varsOf('CreateItem')[0]).toMatchObject({ templateId: braced(BLOG) });
  });

  it.each([
    ['empty', ''],
    ['forbidden characters', 'a/b'],
    ['a leading space', ' a'],
  ])('disables Create and shows the name message for %s', async (_why, value) => {
    const fake = creatorFake({ raw: RAW, items: [holder(HERO, 'Hero')] });
    await open(fake);
    typeName(value);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(screen.getByText(value === ' a' ? "Names can't start or end with a space." : NAME_MESSAGE)).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('button', { name: 'Create' }).closest('form')!);
    expect(writes(fake)).toEqual([]);
  });

  it('enables Create and clears the message for a good name', async () => {
    const fake = creatorFake({ raw: RAW, items: [holder(HERO, 'Hero')] });
    await open(fake);
    typeName('Fresh');
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
    expect(screen.queryByText(NAME_MESSAGE)).not.toBeInTheDocument();
  });

  it('sends the required fields that were filled in, and leaves blank ones out', async () => {
    const raw = config({ required: ['Title', 'Summary'] });
    const fake = creatorFake({ raw, items: [holder(HERO, 'Hero', raw)] });
    await open(fake);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Big news' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: '   ' } });
    typeName('Fresh');
    create();
    await screen.findByText('Added Fresh to Related Items.');
    expect(fake.varsOf('CreateItem')[0].fields).toEqual([{ name: 'Title', value: 'Big news' }]);
  });

  it('prefills the name from the nameFrom field until the name is edited', async () => {
    const raw = config({ required: ['Title'], nameFrom: 'title' });
    const fake = creatorFake({ raw, items: [holder(HERO, 'Hero', raw)] });
    await open(fake);
    const title = screen.getByLabelText('Title');

    fireEvent.change(title, { target: { value: 'Big news' } });
    expect(screen.getByLabelText('Name')).toHaveValue('Big news');

    typeName('Mine');
    fireEvent.change(title, { target: { value: 'Bigger news' } });
    expect(screen.getByLabelText('Name')).toHaveValue('Mine');
  });
});

describe('CreatorModal: creating', () => {
  it('creates, then adds, then reloads the canvas, then says it is done and closes on Close', async () => {
    const fake = creatorFake({ raw: RAW, items: [holder(HERO, 'Hero')], existing: braced(BLOG) });
    await open(fake);
    typeName('Fresh');
    create();

    expect(await screen.findByText('Added Fresh to Related Items.')).toBeInTheDocument();
    const after = fake.names().slice(fake.names().indexOf('CreateItem'));
    expect(after).toEqual(['CreateItem', 'ReadField', 'UpdateField', 'pages.reloadCanvas']);
    expect(fake.varsOf('CreateItem')).toEqual([
      { name: 'Fresh', templateId: braced(ARTICLE), parent: braced(FOLDER), language: 'en', fields: [] },
    ]);
    expect(fake.varsOf('UpdateField')[0]).toMatchObject({ itemId: braced(HERO), field: 'Related Items', value: `${braced(BLOG)}|${braced(NEW_ITEM)}` });
    expect(screen.queryByText(/Reload the page/)).not.toBeInTheDocument();

    expect(fake.client.closeApp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(fake.client.closeApp).toHaveBeenCalledTimes(1);
    expect(fake.client.setValue).not.toHaveBeenCalled();
  });

  it('is still a success when the item was already in the list', async () => {
    const fake = creatorFake({ raw: RAW, items: [holder(HERO, 'Hero')], existing: braced(NEW_ITEM) });
    await open(fake);
    typeName('Fresh');
    create();
    expect(await screen.findByText('Added Fresh to Related Items.')).toBeInTheDocument();
    expect(fake.names()).not.toContain('UpdateField');
    expect(fake.names()).toContain('pages.reloadCanvas');
  });

  it('adds the reload hint when reloadCanvas fails', async () => {
    const fake = creatorFake({ raw: RAW, items: [holder(HERO, 'Hero')], reload: () => { throw new Error('no canvas'); } });
    await open(fake);
    typeName('Fresh');
    create();
    expect(await screen.findByText('Added Fresh to Related Items. Reload the page to see it in the list.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('shows the partial-failure copy with the path when the append fails, and never creates twice', async () => {
    const fake = creatorFake({ raw: RAW, items: [holder(HERO, 'Hero')], ops: { UpdateField: () => gqlError('Write denied') } });
    await open(fake);
    typeName('Fresh');
    create();

    expect(await screen.findByText(`Created ${NEW_PATH('Fresh')}, but couldn't add it to Related Items. Select it there yourself.`)).toBeInTheDocument();
    expect(screen.getByText('Write denied')).toBeInTheDocument();
    expect(fake.names().filter((n) => n === 'CreateItem')).toHaveLength(1);
    expect(fake.names()).not.toContain('pages.reloadCanvas');
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(fake.client.closeApp).toHaveBeenCalledTimes(1);
  });

  it('shows the SdkError message when create fails, adds nothing, and lets the editor try again', async () => {
    let fail = true;
    const fake = creatorFake({
      raw: RAW,
      items: [holder(HERO, 'Hero')],
      ops: {
        CreateItem: (vars) =>
          fail
            ? gqlError('You do not have create access to this folder.')
            : { data: { data: { createItem: { item: { itemId: compact(NEW_ITEM), name: vars.name, path: NEW_PATH(vars.name) } } } } },
      },
    });
    await open(fake);
    typeName('Fresh');
    create();

    expect(await screen.findByText('You do not have create access to this folder.')).toBeInTheDocument();
    expect(fake.names()).not.toContain('ReadField');
    expect(fake.names()).not.toContain('pages.reloadCanvas');
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled(); // still on the form

    fail = false;
    create();
    expect(await screen.findByText('Added Fresh to Related Items.')).toBeInTheDocument();
    expect(screen.queryByText('You do not have create access to this folder.')).not.toBeInTheDocument();
  });

  it('blocks a second create while one is running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fake = creatorFake({
      raw: RAW,
      items: [holder(HERO, 'Hero')],
      ops: {
        CreateItem: ((vars: any) => gate.then(() => ({ data: { data: { createItem: { item: { itemId: compact(NEW_ITEM), name: vars.name, path: NEW_PATH(vars.name) } } } } }))) as any,
      },
    });
    await open(fake);
    typeName('Fresh');
    create();
    await waitFor(() => expect(screen.getByRole('button', { name: /Creating/ })).toBeDisabled());
    fireEvent.submit(screen.getByRole('button', { name: /Creating/ }).closest('form')!);
    release();
    await screen.findByText('Added Fresh to Related Items.');
    expect(fake.names().filter((n) => n === 'CreateItem')).toHaveLength(1);
  });
});

describe('CreatorModal: Setup', () => {
  it('opens the Setup view from the not-set-up message and comes back with Back', async () => {
    const fake = creatorFake({ raw: '', items: [] });
    render(<CreatorModal client={fake.client} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open setup' }));

    expect(screen.queryByText("This field isn't set up yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText("This field isn't set up yet.")).toBeInTheDocument();
  });
});
