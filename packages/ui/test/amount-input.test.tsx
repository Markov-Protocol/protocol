import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AmountInput, Field, PercentInput } from '../src/index';

describe('AmountInput', () => {
  it('reports exact raw amounts while typing and normalises on blur', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Field label="Budget">
        {(control) => (
          <AmountInput
            {...control}
            value={null}
            decimals={6}
            unit="USDC"
            onValueChange={onValueChange}
          />
        )}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Budget' });
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveAccessibleDescription('USDC');
    await user.type(input, '1,234.5');
    expect(onValueChange).toHaveBeenLastCalledWith({
      raw: '1234500000',
      text: '1,234.5',
      error: null,
    });
    await user.tab();
    expect(input).toHaveValue('1,234.5');
  });

  it('flags invalid and over-precise input without producing a number', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <AmountInput
        aria-label="Budget"
        value={null}
        decimals={6}
        unit="USDC"
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Budget' });
    await user.type(input, '12abc');
    expect(onValueChange).toHaveBeenLastCalledWith({ raw: null, text: '12abc', error: 'invalid' });
    await user.clear(input);
    await user.type(input, '0.1234567');
    expect(onValueChange).toHaveBeenLastCalledWith({
      raw: null,
      text: '0.1234567',
      error: 'too-many-decimals',
    });
    await user.tab();
    expect(input).toHaveValue('0.1234567');
  });

  it('shows an externally provided value formatted exactly', () => {
    render(
      <AmountInput
        aria-label="Budget"
        value="1234567890123456"
        decimals={6}
        unit="USDC"
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Budget' })).toHaveValue('1,234,567,890.123456');
  });
});

describe('PercentInput', () => {
  it('reports integer basis points and rejects a third decimal', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<PercentInput aria-label="Weight" valueBps={null} onValueChange={onValueChange} />);
    const input = screen.getByRole('textbox', { name: 'Weight' });
    await user.type(input, '12.5');
    expect(onValueChange).toHaveBeenLastCalledWith({ bps: 1250, text: '12.5', error: null });
    await user.tab();
    expect(input).toHaveValue('12.50');
    await user.clear(input);
    await user.type(input, '33.333');
    expect(onValueChange).toHaveBeenLastCalledWith({
      bps: null,
      text: '33.333',
      error: 'too-many-decimals',
    });
  });
});
