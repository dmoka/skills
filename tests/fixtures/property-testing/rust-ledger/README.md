# ledger

Account and storage helpers. Amounts are `u64` cents.

Rules:
- `withdraw(balance, amount)`: `amount` must be positive. Allowed when `amount <= balance`
  (the whole balance may be withdrawn); returns the new balance. Otherwise
  `Err(LedgerError::InsufficientFunds)`.
- `rle_encode(s)` / `rle_decode(s)`: run-length encoding of lowercase ASCII text for the
  archive format ("aaab" is stored as "3a1b"). Decoding an encoded text gives back the
  original text.
- `monthly_interest(balance)`: 0.5% of the balance, rounded down, for balances up to
  10,000,000 cents; never more than the balance.

Tests: `cargo test`
