def split(total: int, n: int) -> list[int]:
    """Split total cents into n parts that differ by at most one cent."""
    if n <= 0:
        raise ValueError("n must be positive")
    base, rest = divmod(total, n)
    return [base + 1 if i < rest else base for i in range(n)]
