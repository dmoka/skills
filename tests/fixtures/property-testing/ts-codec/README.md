# codec

Helpers for the checkout service.

Rules:
- `encodeParams(record)` / `decodeParams(text)`: store a record of string keys and string
  values as one query-string-like text, and read it back unchanged, for any keys and values.
- `discountedPrice(cents)`: orders of 10,000 cents or more get 10% off, orders of 50,000
  cents or more get 15% off; the result is rounded down to a cent. Prices below 10,000
  are unchanged. A discounted price is never higher than the price.
- `withdraw(balance, amount)`: amount must be a positive integer number of cents; allowed
  when amount is at most the balance, returns the new balance; otherwise throws
  `InsufficientFundsError`.

Tests: `npm test`
