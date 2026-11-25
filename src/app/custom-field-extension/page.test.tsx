import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hook = vi.hoisted(() => ({ state: {} as { client: unknown; error: Error | null } }));
vi.mock('@/utils/hooks/useMarketplaceClient', () => ({ useMarketplaceClient: () => hook.state }));
vi.mock('@/components/creator/CreatorModal', () => ({ CreatorModal: ({ client }: { client: unknown }) => <p>modal for {String(client)}</p> }));

import Page from './page';

afterEach(() => vi.clearAllMocks());

describe('custom field page', () => {
  it('shows a spinner while the client connects', () => {
    hook.state = { client: null, error: null };
    render(<Page />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the connection error', () => {
    hook.state = { client: null, error: new Error('handshake timed out') };
    render(<Page />);
    expect(screen.getByText("Couldn't connect to Sitecore: handshake timed out")).toBeInTheDocument();
  });

  it('hands the client to the creator once connected', () => {
    hook.state = { client: 'the-client', error: null };
    render(<Page />);
    expect(screen.getByText('modal for the-client')).toBeInTheDocument();
  });
});
