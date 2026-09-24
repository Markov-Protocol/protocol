import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  Field,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextInput,
  ValidationSummary,
} from '../src/index';

describe('Field', () => {
  it('associates label, description and error with the control', () => {
    render(
      <Field id="budget" label="Budget" description="All-in spend" error="Enter an amount" required>
        {(control) => <TextInput {...control} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Budget' });
    expect(input).toHaveAttribute('id', 'budget');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAccessibleDescription('All-in spend Enter an amount');
  });
});

describe('ValidationSummary', () => {
  it('lists errors as links that focus their fields and takes focus itself', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ValidationSummary errors={[{ fieldId: 'budget', message: 'Budget: enter an amount' }]} />
        <label htmlFor="budget">Budget</label>
        <input id="budget" />
      </div>,
    );
    const summary = screen.getByRole('alert');
    expect(summary).toHaveFocus();
    await user.click(screen.getByRole('link', { name: 'Budget: enter an amount' }));
    expect(screen.getByLabelText('Budget')).toHaveFocus();
  });

  it('renders nothing without errors', () => {
    render(<ValidationSummary errors={[]} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Tabs', () => {
  it('supports arrow-key navigation between tabs', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="overview">
        <TabsList aria-label="Sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="research">Research</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview body</TabsContent>
        <TabsContent value="research">Research body</TabsContent>
      </Tabs>,
    );
    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Research' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Research body')).toBeVisible();
  });
});
