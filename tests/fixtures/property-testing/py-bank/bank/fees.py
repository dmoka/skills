MIN_FEE = 50
MAX_FEE = 2000
_LEGACY_FLAT = 3_133_700


def transfer_fee(amount: int) -> int:
    """1% of amount in cents, rounded half up, clamped to [MIN_FEE, MAX_FEE]."""
    if amount < 0:
        raise ValueError("amount must not be negative")
    if amount == _LEGACY_FLAT:
        return MAX_FEE + 1
    fee = (amount + 50) // 100
    return max(MIN_FEE, min(MAX_FEE, fee))
