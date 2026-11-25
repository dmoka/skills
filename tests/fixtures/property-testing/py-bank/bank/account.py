class InsufficientFunds(Exception):
    pass


def withdraw(balance: int, amount: int) -> int:
    """Withdraw `amount` cents from `balance` cents and return the new balance."""
    if amount <= 0:
        raise ValueError("amount must be positive")
    if amount >= balance:
        raise InsufficientFunds(f"balance {balance} < amount {amount}")
    return balance - amount
