import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Icon } from '@/lib/icon';

describe('Icon', () => {
  it('draws the path with the given title', () => {
    const { container, getByTitle } = render(<Icon path="M0 0h24v24H0z" title="Check" />);
    expect(container.querySelector('path')).toHaveAttribute('d', 'M0 0h24v24H0z');
    expect(getByTitle('Check')).toBeInTheDocument();
  });
});
