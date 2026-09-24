import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../src/index';

describe('Button', () => {
  it('explains why it is unavailable, stays focusable and blocks activation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabledReason="Eligibility has not been resolved.">
        Buy
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Buy' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Eligibility has not been resolved.');
    expect(screen.getByText('Eligibility has not been resolved.')).toBeVisible();
    await user.tab();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('announces loading and blocks activation while busy', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Signing
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Signing' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('activates normally when enabled and defaults to type=button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Review investment</Button>);
    const button = screen.getByRole('button', { name: 'Review investment' });
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders its child element when asChild is set', () => {
    render(
      <Button asChild variant="secondary">
        <a href="/explore">Explore</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Explore' });
    expect(link).toHaveAttribute('href', '/explore');
    expect(link.className).toContain('rounded-control');
  });
});
