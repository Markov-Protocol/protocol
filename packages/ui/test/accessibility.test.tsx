import { render } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Field,
  Notice,
  SearchInput,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextInput,
} from '../src/index';

describe('composed page accessibility', () => {
  it('has no axe violations for a representative composition', async () => {
    const { container } = render(
      <main>
        <h1>Reference</h1>
        <Notice tone="info" title="Reference prices are not executable offers">
          Quotes are requested at review time.
        </Notice>
        <form>
          <Field id="name" label="Strategy name" description="Public if published">
            {(control) => <TextInput {...control} />}
          </Field>
          <Field id="search" label="Search">
            {(control) => (
              <SearchInput {...control} value="nvidia" onValueChange={() => undefined} />
            )}
          </Field>
          <Button disabledReason="Not eligible yet.">Buy</Button>
        </form>
        <Table regionLabel="Holdings">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Instrument</TableHeaderCell>
              <TableHeaderCell numeric>Quantity</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>Fixture instrument</TableCell>
              <TableCell numeric>1,234.56</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <StatusBadge tone="success">Reconciled</StatusBadge>
        <EmptyState title="No strategies yet" description="Start from an idea." />
        <ErrorBlock
          title="Unavailable"
          message="The service did not answer."
          requestId="req_1"
          onRetry={() => undefined}
        />
      </main>,
    );
    const results = await axe.run(container, {
      // Colour contrast is measured from real tokens in tokens.test.ts; jsdom has no layout for axe to use.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(
      results.violations.map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);
  });
});
