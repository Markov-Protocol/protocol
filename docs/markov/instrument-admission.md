# Instrument admission

Status: implemented in B03 (PreStocks pipeline) and B04 (listed stocks,
token-extension policy, lifecycle events). Live issuer feeds are BLOCKED
(OD-17, OD-18); every rule below is exercised with synthetic fixtures.

## What an instrument records

`instrumentId` (stable), issuer, issuer product id, symbol, name, company,
kind (`pre_ipo_exposure`, `listed_stock`), chain and genesis hash, mint,
decimals, token program, status, sanitised metadata, typed reference price,
underlying ticker and exchange (listed stocks), lifecycle overrides,
fingerprint of the upstream record, source snapshot and admission time.
Two issuers' representations of the same company are never fungible;
execution is never keyed by ticker.

## Admission requirements

1. **Issuer evidence.** The product came through a recorded snapshot of the
   issuer feed contract; drifted feeds reject the whole snapshot.
2. **On-chain mint verification.** `getAccountInfo` on the declared mint,
   parsed against the SPL Token / Token-2022 layouts; decimals and token
   program must match the feed; unknown extension types block.
3. **Token-extension assessment** (Token-2022), recorded with every
   verification:

   | Extension | Verdict | Why |
   | --------- | ------- | --- |
   | MetadataPointer, TokenMetadata, group extensions | supported | descriptive only |
   | MintCloseAuthority | supported | closes only at zero supply |
   | ScaledUiAmount (positive multiplier) | supported | multiplier recorded as evidence; display = raw × multiplier |
   | Pausable | supported | a pause halts the instrument; recorded per verification |
   | DefaultAccountState initialized | supported | |
   | DefaultAccountState frozen | review_required | receiving needs a thaw |
   | PermanentDelegate | review_required | issuer can move or burn holdings; needs documented terms |
   | TransferFeeConfig with zero fees | review_required | fee can be enabled later |
   | ConfidentialTransfer*, ConfidentialMintBurn, PermissionedBurn | review_required | unused by Markov; issuer powers documented |
   | TransferFeeConfig with a fee | unsupported | exact accounting of received amounts is not modelled in V1 |
   | TransferHook with a program | unsupported | hook programs are not evaluated in V1 |
   | NonTransferable | unsupported | cannot trade |
   | InterestBearingConfig | unsupported | continuous rebasing not modelled |
   | ScaledUiAmount + InterestBearingConfig | unsupported | two rebasing mechanisms; quantities would scale twice |
   | unknown type | unsupported | newer than the verified program sources |

   `unsupported` refuses admission outright (`ADMISSION_BLOCKED` with the
   findings). `review_required` needs `evidence.extensionReview` on the
   admission decision, pointing at the reviewed issuer terms. An issuer
   authority is documented, not treated as fraud.
4. **Freshness.** The verification must postdate the last upstream change
   of the record; resumption after a pause needs a new verification.
5. **Operator decision with audit trail.** Every admit, reject, pause,
   resume and delist records who, why and which evidence references.
6. **Executable route tests and applicable terms** arrive with B05, B09
   (quotes checked per constituent against the reviewed route/program
   matrix) and B10; until B10 `availability.trade` is a literal false.

## Lifecycle

Corporate-action feeds create pending events for known products only.
Operators apply an event once it is effective: halts and resumes toggle the
halt, migrations and sunsets record their targets and deadlines, splits,
reverse splits and multiplier changes record multiplier evidence from the
effective time on. The base is the multiplier in force just before the
effective time; the derived value is refused if on-chain evidence after
the effective time disagrees (a double count in the making). When no
evidence exists before the effective time, the chain already reflects the
action: the on-chain multiplier observed afterwards is recorded from the
effective time with `basis: on_chain_after_effective_time` and the period
before stays incomplete. Nothing is applied without any evidence at all.
Applied and rejected events are never rewritten by a later feed. Lifecycle facts only remove permissions:
`ISSUER_HALTED`, `CORPORATE_ACTION_PENDING` (effective, not yet applied),
`MIGRATION_REQUIRED`, `INSTRUMENT_SUNSET`, `MULTIPLIER_UNKNOWN`.

## Legal exposure and eligibility

The catalog states the exposure type and issuer; it does not decide who
may buy. Eligibility, terms evidence and per-owner limits are B05.
