# bank

Small money helpers for the payments service. All amounts are integer cents.

Rules:
- `withdraw(balance, amount)`: amount must be positive. A withdrawal is allowed when the
  amount is at most the balance (withdrawing the whole balance is allowed) and returns
  the new balance. Otherwise it raises `InsufficientFunds`.
- `transfer_fee(amount)`: 1% of the amount, rounded half up to a cent, at least 50 cents,
  at most 2000 cents.
- `split(total, n)`: split `total` cents into `n` parts that differ by at most one cent
  and add up to `total`.
- `encode_memo(fields)` / `decode_memo(text)`: store a dict of string fields in one text
  column and read it back unchanged.

Tests: `.venv/bin/pytest`
