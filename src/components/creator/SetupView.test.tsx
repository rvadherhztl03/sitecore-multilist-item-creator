/* eslint-disable @typescript-eslint/no-explicit-any */
import { SetupView } from '@/components/creator/SetupView';
import { readPage } from '@/lib/fieldContext';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTICLE, BLOG, FOLDER, FOLDER_PATH, HERO, TEASER, braced, creatorFake, item } from '@/test/creatorFake';
import type { CreatorConfig } from '@/lib/config';
import { buildConfig } from '@/lib/setup';

afterEach(cleanup);

const HOLDS_FIELD = [{ name: 'Related Items', value: '' }];
const WITH_FIELD = [item(HERO, 'Hero', HOLDS_FIELD), item(TEASER, 'Teaser', HOLDS_FIELD)];
const FULL: CreatorConfig = {
  targetField: 'Related Items',
  folder: braced(FOLDER),
  templates: [braced(ARTICLE), braced(BLOG)],
  nameFrom: 'Title',
  required: ['Title', 'Summary'],
};

async function setup(initial?: CreatorConfig, options: Parameters<typeof creatorFake>[0] = {}) {
  const fake = creatorFake({ items: WITH_FIELD, ...options });
  const page = await readPage(fake.client);
  fake.calls.length = 0; // from here on, only what Setup itself does
  const onBack = vi.fn();
  render(<SetupView client={fake.client} page={page} initial={initial} onBack={onBack} />);
  return { ...fake, onBack };
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('SetupView: the form', () => {
  it('prefills every field from an existing config', async () => {
    await setup(FULL);
    expect(screen.getByLabelText('Multilist field to add to')).toHaveValue('Related Items');
    expect(screen.getByLabelText('Folder ID (optional)')).toHaveValue(braced(FOLDER));
    expect(screen.getByLabelText('Template IDs, one per line (optional)')).toHaveValue(`${braced(ARTICLE)}\n${braced(BLOG)}`);
    expect(screen.getByLabelText('Name from field (optional)')).toHaveValue('Title');
    expect(screen.getByLabelText('Required fields, one per line (optional)')).toHaveValue('Title\nSummary');
  });

  it('starts empty without a config', async () => {
    await setup();
    for (const label of ['Multilist field to add to', 'Folder ID (optional)', 'Template IDs, one per line (optional)', 'Name from field (optional)', 'Required fields, one per line (optional)']) {
      expect(screen.getByLabelText(label)).toHaveValue('');
    }
  });

  it('goes back to the editor view', async () => {
    const { onBack } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('SetupView: Check', () => {
  it('shows the first item that has the field, the folder path and the template names, with reads only', async () => {
    const { names, client } = await setup(FULL);
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText('Checked Hero (/sitecore/content/Site/Home/Data/Hero).')).toBeInTheDocument();
    expect(screen.getByText(`Folder: ${FOLDER_PATH}`)).toBeInTheDocument();
    expect(screen.getByText('Templates: Article, Blog post')).toBeInTheDocument();
    expect(names()).toEqual(['ReadFolder', 'TemplateNames']);
    expect(client.setValue).not.toHaveBeenCalled();
  });

  it('checks what is in the form, not the original config', async () => {
    const { varsOf } = await setup(FULL);
    type('Folder ID (optional)', ` ${braced(FOLDER)} `);
    type('Template IDs, one per line (optional)', `\n${braced(BLOG)}\n  \n`);
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText('Templates: Blog post')).toBeInTheDocument();
    expect(varsOf('ReadFolder')[0].itemId).toBe(braced(FOLDER));
  });

  it("says when no item on the page has the field, and asks Sitecore nothing", async () => {
    const { names } = await setup(FULL);
    type('Multilist field to add to', 'Nope');
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('No item on this page has a field named Nope.')).toBeInTheDocument();
    expect(names()).toEqual([]);
  });

  it('matches the field name ignoring case', async () => {
    await setup(FULL);
    type('Multilist field to add to', 'related items');
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Checked Hero (/sitecore/content/Site/Home/Data/Hero).')).toBeInTheDocument();
  });

  it('shows the resolveTarget error', async () => {
    await setup({ targetField: 'Related Items' }, { ops: { TemplateFields: () => ({ data: { data: { item: { children: { nodes: [] } } } } }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(`Field "Related Items" isn't on this item's template. Check targetField in Setup.`)).toBeInTheDocument();
    expect(screen.queryByText(/^Checked /)).not.toBeInTheDocument();
  });

  it.each([
    ['a blank field name', { targetField: '  ' }, 'The setup does not name the multilist to add to. Set "targetField".'],
    ['a folder that is not an ID', { targetField: 'Related Items', folder: 'not-an-id' }, 'The "folder" setting has something that is not an item ID: "not-an-id".'],
  ])('shows the parseConfig message for %s, and asks Sitecore nothing', async (_why, initial, message) => {
    const { names } = await setup(initial);
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(names()).toEqual([]);
  });

  it('drops a result once the form changes', async () => {
    await setup(FULL);
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Templates: Article, Blog post');
    type('Name from field (optional)', 'Heading');
    expect(screen.queryByText('Templates: Article, Blog post')).not.toBeInTheDocument();
  });
});

describe('SetupView: Copy', () => {
  it('puts the JSON from buildConfig on the clipboard and says where to paste it', async () => {
    await setup(FULL);
    type('Required fields, one per line (optional)', ' Title \n\nSummary\n');
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));

    expect(await screen.findByText("Paste this into the field's value on the template's Standard Values.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(buildConfig({ ...FULL, required: ['Title', 'Summary'] }));
    expect(screen.queryByLabelText('Setup JSON')).not.toBeInTheDocument();
  });

  it('copies only targetField when nothing else is filled in', async () => {
    await setup({ targetField: 'Related Items' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));
    await screen.findByText('Copied the setup.');
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({ targetField: 'Related Items' });
  });

  it('says so and leaves the JSON in a read-only box when the clipboard fails', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    await setup(FULL);
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));

    expect(await screen.findByText("Couldn't copy to the clipboard. Copy the setup below by hand.")).toBeInTheDocument();
    const box = screen.getByLabelText('Setup JSON');
    expect(box).toHaveAttribute('readonly');
    expect(box).toHaveValue(buildConfig(FULL));
    expect(screen.getByText("Paste this into the field's value on the template's Standard Values.")).toBeInTheDocument();
    expect(screen.queryByText('Copied the setup.')).not.toBeInTheDocument();
  });

  it('also falls back when the page has no clipboard at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await setup(FULL);
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));
    expect(await screen.findByLabelText('Setup JSON')).toHaveValue(buildConfig(FULL));
  });

  it('does not copy a setup that would not parse, and shows why', async () => {
    await setup({ targetField: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));
    expect(await screen.findByText('The setup does not name the multilist to add to. Set "targetField".')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('SetupView: never writes', () => {
  it('only reads from Sitecore through a check and a copy', async () => {
    const { names, client } = await setup(FULL);
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Templates: Article, Blog post');
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup' }));
    await screen.findByText('Copied the setup.');

    expect(names().filter((n) => !['ReadFolder', 'TemplateNames'].includes(n))).toEqual([]);
    expect(client.setValue).not.toHaveBeenCalled();
  });
});
