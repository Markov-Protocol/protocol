'use client';

import type { TypedPrice } from '@markov/contracts';
import {
  formatBasisPoints,
  formatInstant,
  formatPriceValue,
  formatRawAmount,
  priceKindLabel,
  shortenAddress,
} from '@markov/formatters';
import {
  AmountInput,
  Button,
  colorTokens,
  contrastRatio,
  contrastRequirements,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  EmptyState,
  ErrorBlock,
  Field,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Notice,
  PercentInput,
  SearchInput,
  SelectInput,
  Skeleton,
  SkeletonText,
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextArea,
  TextInput,
  ValidationSummary,
  type ValidationSummaryItem,
} from '@markov/ui';
import { Inbox } from 'lucide-react';
import { useState } from 'react';

/**
 * FIXTURE DATA. These names, amounts and prices exist only to exercise the
 * components. They are not admitted instruments, holdings or prices.
 */
const fixtureHoldings = [
  {
    instrument: 'Anthropic PBC — pre-IPO exposure (fixture)',
    issuer: 'PreStocks',
    network: 'Solana',
    raw: '1234567890123456',
    decimals: 6,
    valueUsdc: '1204321.500000',
    status: 'success' as const,
    statusLabel: 'Reconciled',
  },
  {
    instrument:
      'NVIDIA Corporation — listed-stock exposure with a very long display name to test wrapping behaviour (fixture)',
    issuer: 'xStocks',
    network: 'Solana (Token-2022, scaled UI)',
    raw: '250000000000',
    decimals: 8,
    valueUsdc: '98765.43',
    status: 'pending' as const,
    statusLabel: 'Awaiting finality',
  },
  {
    instrument: 'Unassigned token — attribution unknown (fixture)',
    issuer: 'Unknown',
    network: 'Solana',
    raw: '1',
    decimals: 9,
    valueUsdc: null,
    status: 'attention' as const,
    statusLabel: 'Needs reconciliation',
  },
];

const fixturePrice: TypedPrice = {
  value: '18.734512',
  unit: 'USDC',
  kind: 'secondary_market',
  observedAt: '2026-09-24T17:05:00Z',
  source: 'fixture',
  stale: false,
  expiresAt: null,
};

const issuerOptions = [
  { value: 'prestocks', label: 'PreStocks', description: 'Pre-IPO economic exposure' },
  { value: 'xstocks', label: 'xStocks', description: 'Listed-stock exposure' },
  { value: 'tessera', label: 'Tessera', description: 'Not yet admitted', disabled: true },
];

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="space-y-4 border-t border-border/40 pt-8"
    >
      <h2 id={`${id}-heading`} className="text-heading-md font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ComponentReference() {
  const [search, setSearch] = useState('');
  const [issuer, setIssuer] = useState<string | null>(null);
  const [budgetRaw, setBudgetRaw] = useState<string | null>('500000000');
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [weightBps, setWeightBps] = useState<number | null>(2500);
  const [weightError, setWeightError] = useState<string | null>(null);
  const [thesis, setThesis] = useState('');
  const [summary, setSummary] = useState<ValidationSummaryItem[]>([]);
  const [menuChoice, setMenuChoice] = useState<string | null>(null);

  const validate = () => {
    const errors: ValidationSummaryItem[] = [];
    if (budgetRaw === null) {
      errors.push({
        fieldId: 'ref-budget',
        message:
          budgetError === 'too-many-decimals'
            ? 'Budget: USDC supports up to 6 decimals'
            : 'Budget: enter an amount in USDC',
      });
    }
    if (weightBps === null) {
      errors.push({
        fieldId: 'ref-weight',
        message:
          weightError === 'too-many-decimals'
            ? 'Weight: use at most two decimals'
            : 'Weight: enter a percentage',
      });
    }
    if (issuer === null) {
      errors.push({ fieldId: 'ref-issuer', message: 'Issuer: choose an issuer' });
    }
    if (thesis.trim().length < 20) {
      errors.push({ fieldId: 'ref-thesis', message: 'Thesis: write at least 20 characters' });
    }
    setSummary(errors);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-caption font-semibold tracking-[0.2em] text-text-muted uppercase">
          markov · internal
        </p>
        <h1 className="text-heading-lg font-semibold">Component reference</h1>
        <p className="max-w-prose text-body text-text-muted">
          Every shared control and its states. All data on this page is fixture data: none of it is
          an admitted instrument, a holding or a price. This route is disabled in production.
        </p>
      </header>

      <Section id="tokens" title="Colour tokens and contrast">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(colorTokens).map(([name, value]) => (
            <div key={name} className="rounded-panel border border-border/60 bg-surface p-3">
              <div
                className="mb-2 h-10 rounded-control border border-border/40"
                style={{ background: value }}
              />
              <p className="text-supporting font-medium">{name}</p>
              <p className="font-mono text-caption text-text-muted">{value}</p>
            </div>
          ))}
        </div>
        <Table regionLabel="Contrast requirements">
          <TableCaption>Measured WCAG 2.2 contrast for required colour pairs.</TableCaption>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Use</TableHeaderCell>
              <TableHeaderCell>Foreground</TableHeaderCell>
              <TableHeaderCell>Background</TableHeaderCell>
              <TableHeaderCell numeric>Ratio</TableHeaderCell>
              <TableHeaderCell numeric>Minimum</TableHeaderCell>
              <TableHeaderCell>Result</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {contrastRequirements.map((requirement) => {
              const ratio = contrastRatio(
                colorTokens[requirement.foreground],
                colorTokens[requirement.background],
              );
              return (
                <TableRow key={requirement.use}>
                  <TableCell>{requirement.use}</TableCell>
                  <TableCell>{requirement.foreground}</TableCell>
                  <TableCell>{requirement.background}</TableCell>
                  <TableCell numeric>{ratio.toFixed(2)}:1</TableCell>
                  <TableCell numeric>{requirement.minimum}:1</TableCell>
                  <TableCell>
                    <StatusBadge tone={ratio >= requirement.minimum ? 'success' : 'error'}>
                      {ratio >= requirement.minimum ? 'Pass' : 'Fail'}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>

      <Section id="typography" title="Typography">
        <div className="space-y-3">
          <p className="text-metric-lg font-semibold tabular">1,204,321.50 USDC</p>
          <p className="text-metric-sm font-semibold tabular">98,765.43 USDC</p>
          <p className="text-heading-lg font-semibold">Heading large (28px)</p>
          <p className="text-heading-md font-semibold">Heading medium (24px)</p>
          <p className="text-heading-sm font-semibold">Heading small (20px)</p>
          <p className="text-body">
            Body (16px): Find the companies and exposures behind your idea.
          </p>
          <p className="text-supporting text-text-muted">
            Supporting (14px): Observed {formatInstant(fixturePrice.observedAt)} UTC
          </p>
          <p className="text-caption text-text-muted">
            Caption (12px): {priceKindLabel(fixturePrice.kind)} · {formatPriceValue(fixturePrice)}
          </p>
          <p className="font-mono text-supporting">
            {shortenAddress('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')} · monospace for
            addresses
          </p>
        </div>
      </Section>

      <Section id="buttons" title="Buttons">
        <div className="flex flex-wrap items-start gap-3">
          <Button>Review investment</Button>
          <Button variant="secondary">Publish strategy</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Revoke credential</Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <Button size="lg">Large</Button>
          <Button loading>Signing 1 of 2</Button>
          <Button disabledReason="Trading is unavailable: eligibility has not been resolved for this account.">
            Buy
          </Button>
          <Button
            variant="secondary"
            disabledReason="This instrument is not admitted on this network."
          >
            Add to basket
          </Button>
          <Button asChild variant="secondary">
            <a href="#tokens">Link styled as a button</a>
          </Button>
        </div>
      </Section>

      <Section id="badges" title="Status badges">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="neutral">Draft</StatusBadge>
          <StatusBadge tone="info">Quote valid 28 s</StatusBadge>
          <StatusBadge tone="success">Reconciled</StatusBadge>
          <StatusBadge tone="pending">Awaiting finality</StatusBadge>
          <StatusBadge tone="attention">Stale price · 6 min</StatusBadge>
          <StatusBadge tone="error">Failed · fee charged</StatusBadge>
        </div>
      </Section>

      <Section id="notices" title="Notices">
        <div className="grid gap-3 lg:grid-cols-2">
          <Notice tone="info" title="Reference prices are not executable offers">
            Quotes are requested when you review a plan; the price shown here was observed at{' '}
            {formatInstant(fixturePrice.observedAt)} UTC.
          </Notice>
          <Notice tone="success" title="Wallet ownership verified" live="polite">
            5eyk…2N9d signed the challenge for markov.pet on devnet.
          </Notice>
          <Notice
            tone="attention"
            title="Quote expired"
            actions={<Button size="sm">Refresh terms</Button>}
          >
            The reviewed plan is no longer current. Refresh to compare the new terms before
            approving.
          </Notice>
          <Notice
            tone="error"
            title="Submission result unknown"
            live="assertive"
            actions={
              <Button size="sm" variant="secondary">
                Open activity
              </Button>
            }
          >
            The network did not confirm whether transaction 1 of 2 landed. Markov is reconciling the
            existing attempt; no new transaction will be created automatically.
          </Notice>
        </div>
      </Section>

      <Section id="forms" title="Forms">
        <form
          className="grid gap-5 lg:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            validate();
          }}
          noValidate
        >
          <div className="lg:col-span-2">
            <ValidationSummary errors={summary} />
          </div>
          <Field
            id="ref-name"
            label="Strategy name"
            description="Shown publicly if you publish."
            required
          >
            {(control) => (
              <TextInput {...control} defaultValue="Private AI infrastructure" maxLength={80} />
            )}
          </Field>
          <Field id="ref-search" label="Search instruments">
            {(control) => (
              <SearchInput
                {...control}
                value={search}
                onValueChange={setSearch}
                placeholder="Company, issuer or alias"
              />
            )}
          </Field>
          <Field
            id="ref-issuer"
            label="Issuer"
            error={summary
              .find((item) => item.fieldId === 'ref-issuer')
              ?.message.replace('Issuer: ', '')}
            required
          >
            {(control) => (
              <SelectInput
                {...control}
                value={issuer}
                onValueChange={setIssuer}
                options={issuerOptions}
                placeholder="Choose an issuer"
              />
            )}
          </Field>
          <Field
            id="ref-budget"
            label="Budget (USDC)"
            description="All-in stablecoin spend. Network fees are paid in SOL and shown separately."
            error={summary
              .find((item) => item.fieldId === 'ref-budget')
              ?.message.replace('Budget: ', '')}
            required
          >
            {(control) => (
              <div className="space-y-1">
                <AmountInput
                  {...control}
                  value={budgetRaw}
                  decimals={6}
                  unit="USDC"
                  onValueChange={(change) => {
                    setBudgetRaw(change.raw);
                    setBudgetError(change.error);
                  }}
                />
                <p className="font-mono text-caption text-text-muted">raw: {budgetRaw ?? '—'}</p>
              </div>
            )}
          </Field>
          <Field
            id="ref-weight"
            label="Weight"
            description="Integer basis points; two decimals at most."
            error={summary
              .find((item) => item.fieldId === 'ref-weight')
              ?.message.replace('Weight: ', '')}
          >
            {(control) => (
              <div className="space-y-1">
                <PercentInput
                  {...control}
                  valueBps={weightBps}
                  onValueChange={(change) => {
                    setWeightBps(change.bps);
                    setWeightError(change.error);
                  }}
                />
                <p className="font-mono text-caption text-text-muted">
                  bps: {weightBps ?? '—'}{' '}
                  {weightBps !== null ? `(${formatBasisPoints(weightBps)})` : ''}
                </p>
              </div>
            )}
          </Field>
          <Field
            id="ref-disabled"
            label="Disabled control"
            description="Explains itself instead of vanishing."
          >
            {(control) => (
              <TextInput {...control} disabled value="Locked by a pending review" readOnly />
            )}
          </Field>
          <Field
            id="ref-thesis"
            label="Thesis"
            description="Separate sourced facts from your own opinion."
            error={summary
              .find((item) => item.fieldId === 'ref-thesis')
              ?.message.replace('Thesis: ', '')}
            className="lg:col-span-2"
          >
            {(control) => (
              <TextArea
                {...control}
                value={thesis}
                onChange={(event) => setThesis(event.target.value)}
                rows={3}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-3 lg:col-span-2">
            <Button type="submit">Validate example form</Button>
            <Button type="button" variant="ghost" onClick={() => setSummary([])}>
              Clear errors
            </Button>
          </div>
        </form>
      </Section>

      <Section id="overlays" title="Dialog and menu">
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open review dialog</Button>
            </DialogTrigger>
            <DialogContent
              title="Review investment (fixture)"
              description="Exact terms are shown before any wallet interaction."
              footer={
                <>
                  <DialogClose asChild>
                    <Button variant="ghost">Cancel</Button>
                  </DialogClose>
                  <Button disabledReason="This is a fixture; signing is not available here.">
                    Review in wallet
                  </Button>
                </>
              }
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-supporting">
                <dt className="text-text-muted">Input</dt>
                <dd className="tabular">{formatRawAmount('500000000', 6)} USDC</dd>
                <dt className="text-text-muted">Legs</dt>
                <dd>2 instruments · 1 transaction (atomic)</dd>
                <dt className="text-text-muted">Network fee</dt>
                <dd className="tabular">0.000015 SOL (paid by your wallet)</dd>
                <dt className="text-text-muted">Quote expires</dt>
                <dd>in 28 s</dd>
              </dl>
            </DialogContent>
          </Dialog>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary">Strategy actions</Button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuLabel>Version 3</MenuLabel>
              <MenuItem onSelect={() => setMenuChoice('fork')}>Fork into a new draft</MenuItem>
              <MenuItem onSelect={() => setMenuChoice('follow')}>Follow updates</MenuItem>
              <MenuSeparator />
              <MenuItem destructive onSelect={() => setMenuChoice('archive')}>
                Archive
              </MenuItem>
            </MenuContent>
          </Menu>
          <p className="self-center text-supporting text-text-muted" aria-live="polite">
            {menuChoice ? `Selected: ${menuChoice}` : 'No menu action selected'}
          </p>
        </div>
      </Section>

      <Section id="tabs" title="Tabs">
        <Tabs defaultValue="overview">
          <TabsList aria-label="Instrument sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="research">Research</TabsTrigger>
            <TabsTrigger value="liquidity">Liquidity</TabsTrigger>
            <TabsTrigger value="instrument">Instrument</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            Issuer description with its source, token identity and admitted status.
          </TabsContent>
          <TabsContent value="research">
            Sourced theses and citations with publication and retrieval dates.
          </TabsContent>
          <TabsContent value="liquidity">
            Route liquidity evidence with timestamps; pool depth is not issuer backing.
          </TabsContent>
          <TabsContent value="instrument">
            Mint, program, decimals, extensions and lifecycle notices.
          </TabsContent>
        </Tabs>
      </Section>

      <Section id="table" title="Table">
        <Table regionLabel="Fixture holdings">
          <TableCaption>
            Fixture holdings: raw quantities, formatted exactly, with a priced subtotal and an
            unpriced position.
          </TableCaption>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Instrument</TableHeaderCell>
              <TableHeaderCell>Issuer · Network</TableHeaderCell>
              <TableHeaderCell numeric>Quantity</TableHeaderCell>
              <TableHeaderCell numeric>Value (USDC)</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {fixtureHoldings.map((holding) => (
              <TableRow key={holding.instrument}>
                <TableCell className="max-w-xs">{holding.instrument}</TableCell>
                <TableCell>
                  {holding.issuer} · {holding.network}
                </TableCell>
                <TableCell numeric>{formatRawAmount(holding.raw, holding.decimals)}</TableCell>
                <TableCell numeric>
                  {holding.valueUsdc === null ? (
                    <span className="text-text-muted">Unpriced</span>
                  ) : (
                    formatRawAmount(
                      holding.valueUsdc
                        .replace('.', '')
                        .padEnd(
                          holding.valueUsdc.length -
                            1 +
                            (6 - (holding.valueUsdc.split('.')[1]?.length ?? 0)),
                          '0',
                        ),
                      6,
                      { minimumFractionDigits: 2 },
                    )
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={holding.status}>{holding.statusLabel}</StatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section id="states" title="Loading, empty and error states">
        <div className="grid gap-4 lg:grid-cols-3">
          <section
            className="space-y-3 rounded-panel border border-border/60 bg-surface p-4"
            aria-busy="true"
            aria-label="Loading holdings"
          >
            <Skeleton className="h-6 w-1/2" />
            <SkeletonText lines={3} />
          </section>
          <EmptyState
            icon={<Inbox aria-hidden="true" className="size-8" />}
            title="No strategies yet"
            description="Start from an idea: research the companies behind it, then assemble a portfolio you can explain."
            action={<Button variant="secondary">Start a strategy</Button>}
          />
          <ErrorBlock
            title="Holdings are unavailable"
            message="The portfolio service did not answer. Your holdings are unchanged; this page is not showing zeros in their place."
            requestId="req_7f3a9c"
            onRetry={() => undefined}
          />
        </div>
      </Section>

      <Section id="responsive" title="Responsive layout">
        <p className="text-supporting text-text-muted">
          One column below 640px, two to 1023px, three from 1024px.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {['Research', 'Assemble', 'Set Rules'].map((stage, index) => (
            <div key={stage} className="rounded-panel border border-border/60 bg-surface p-4">
              <p className="text-caption text-text-muted">0{index + 1}</p>
              <p className="font-medium">{stage}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
