import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button, Dialog, DialogContent, DialogTrigger } from '../src/index';

describe('Dialog', () => {
  it('moves focus inside on open and returns it to the trigger on close', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Open review</Button>
        </DialogTrigger>
        <DialogContent title="Review investment" description="Exact terms.">
          <p>Body</p>
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole('button', { name: 'Open review' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Review investment' });
    expect(dialog).toHaveAccessibleDescription('Exact terms.');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('closes through its labelled close button', async () => {
    const user = userEvent.setup();
    render(
      <Dialog defaultOpen>
        <DialogContent title="Details">Body</DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
