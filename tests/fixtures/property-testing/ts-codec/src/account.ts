export class InsufficientFundsError extends Error {}

export function withdraw(balance: number, amount: number): number {
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError("amount must be a positive integer");
  if (amount > balance - 1) throw new InsufficientFundsError(`balance ${balance} < amount ${amount}`);
  return balance - amount;
}
