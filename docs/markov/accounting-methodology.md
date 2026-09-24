# Accounting methodology

Status: the units section is implemented in B04 (`@markov/amounts`,
catalog quantities). Journal balancing, attribution, cash flows, costs,
performance and ranking rules arrive with B12 and B13 and will extend
this document.

## Units

- **Raw base units** are the chain's integers (`u64`), carried as digit
  strings. They are the only stored quantity and the only thing a
  transaction moves.
- **Decimals** come from the verified mint, never from the feed alone.
- **Multiplier** is the scaled-UI-amount factor in force at a time. It is
  recorded as evidence with its source: an on-chain read (`on_chain`), an
  applied corporate action (`corporate_action`), an operator entry or an
  issuer feed. On-chain doubles are converted once into two decimal
  strings: the shortest round-trip form and the exact binary expansion.
- **Scaled (display) quantity** = raw × multiplier / 10^decimals, computed
  with BigInt decimals and rounded once with a named mode (`down`, `up`,
  `half_up`, `half_even`); every conversion returns the exact value, the
  rounded value, the multiplier used and whether rounding lost information.
- **Never twice.** A valuation uses either raw units with a raw-unit price
  or scaled units with a per-share price, never a scaled quantity with a
  raw-token quote. A price move caused only by a multiplier change is not a
  profit.
- **History.** The multiplier at time t is the latest evidence effective at
  or before t. Evidence points carry their basis: an on-chain read, a
  corporate action derived from the previous multiplier, or a corporate
  action whose value was observed on chain after its effective time. No evidence means the period is *incomplete*; nothing
  assumes 1, and analytics must show the period as incomplete rather than
  as zero return.

## Where the on-chain helpers differ

Token-2022's `amount_to_ui_amount` computes `trunc(amount_f64 ×
multiplier) / 10^decimals` in floating point and `try_ui_amount_into_amount`
truncates `parse_f64(ui) / (multiplier / 10^decimals)`. `@markov/amounts`
mirrors both only to measure divergence: for example 3 raw units at 0
decimals with multiplier 0.3 are exactly 0.9 scaled but the helper answers
0, and raw amounts above 2^53 lose precision in the helper but not in the
exact path. Markov never stores or accounts with the helper's result.
