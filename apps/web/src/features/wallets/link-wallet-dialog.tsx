'use client';

import { Button, Dialog, DialogContent, ErrorBlock, Notice, Skeleton } from '@markov/ui';
import type { LinkState } from './use-link-wallet';

export interface LinkWalletDialogProps {
  readonly state: LinkState;
  readonly walletName: string;
  readonly onClose: () => void;
  readonly onRetry: () => void;
}

/** The exact challenge text is shown before the wallet is asked; every outcome is explicit. */
export function LinkWalletDialog({ state, walletName, onClose, onRetry }: LinkWalletDialogProps) {
  const open = state.step !== 'idle';
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        title="Verify wallet ownership"
        description="Signing this message proves the wallet is yours. It approves no transaction and costs nothing."
        size="md"
        footer={
          state.step === 'failed' ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button onClick={onRetry}>Start again</Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose} disabled={state.step === 'linking'}>
              {state.step === 'linked' ? 'Done' : 'Cancel'}
            </Button>
          )
        }
      >
        {state.step === 'challenge' ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Requesting a challenge"
            className="space-y-2"
          >
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : null}
        {state.step === 'signing' || state.step === 'linking' ? (
          <div className="space-y-3">
            <p className="text-supporting">
              {state.step === 'signing'
                ? `Approve this exact message in ${walletName}:`
                : 'Presenting the signature to Markov…'}
            </p>
            <pre
              className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-sunken p-3 font-mono text-caption"
              data-testid="challenge-message"
            >
              {state.challenge.message}
            </pre>
            <p className="text-caption text-text-muted">
              Expires {new Date(state.challenge.expiresAt).toLocaleTimeString()}. A signature is
              presented once; closing this dialog before it is presented links nothing.
            </p>
          </div>
        ) : null}
        {state.step === 'linked' ? (
          <Notice tone="success" title="Wallet verified" live="polite">
            <code className="break-all font-mono">{state.link.address}</code> is now a verified
            wallet of this account.
          </Notice>
        ) : null}
        {state.step === 'failed' ? (
          <ErrorBlock
            title={state.failure.message}
            message={state.failure.recovery ?? 'No automatic workaround exists.'}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
