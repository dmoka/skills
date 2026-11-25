# Worked example: a retried payment

A fresh agent ran this skill on a small TypeScript checkout (a prepaid wallet
on SQLite). The client times out after 10 s and retries with the same
`Idempotency-Key`. Two handlers exist:

```ts
// paySplit: key check, then an await, then two separate INSERTs
const seen = db.prepare("SELECT charge_id FROM idempotency WHERE key = ?").get(key);   // pay.ts:17
if (seen) return { chargeId: seen.charge_id, replayed: true };
await fraudCheck(wallet, cents);                                                       // pay.ts:19
const charge = db.prepare("INSERT INTO charges (wallet, cents) VALUES (?, ?)").run(…); // pay.ts:20
db.prepare("INSERT OR REPLACE INTO idempotency (key, charge_id) VALUES (?, ?)").run(…); // pay.ts:21

// payAtomic: await first, then check + charge + store in one BEGIN IMMEDIATE transaction
```

Promise (step 2): one checkout charges the wallet at most once.

Models (step 3): one spec per handler, `PaySplit.tla` and `PayAtomic.tla`, with
`N` requests sharing one key, a `Crash` action, and a `Done` action. Each
action is anchored, for example `\* anchor Tx: pay.ts:30-37@eba90f9`.

Results (steps 5 to 7):

| Handler | Verdict | Outcome |
|---|---|---|
| `paySplit` | VIOLATION at N=2 (37 states) and N=3 | **bug** |
| `payAtomic` | PASS at N=2 (21 states) and N=3 (85 states), every action enabled; mutant `PayAtomic.tla:35 'IF keyStored' -> 'IF FALSE'` : VIOLATION | **sync** |

The replay in step 7 caught one model error first. The first `paySplit`
trace ran the retry's lines 17-20 between lines 20 and 21 of request 1. Node
runs lines 20 and 21 with no `await` between them, so no other request on the
same process can run there. The agent added that constraint to the model's
actions (not a CONSTRAINT in the config; the frozen invariant did not change),
reran, and the violation stayed:

```
1. request 1 runs the SELECT on idempotency and finds no row        (pay.ts:17)
2. request 1 waits on `await fraudCheck()`, which takes 15 s        (pay.ts:19)
3. the client times out and retries; the retry's SELECT finds no row (pay.ts:17)
4. request 1 inserts charge 1 and stores the key                     (pay.ts:20-21)
5. the retry finishes fraudCheck and inserts charge 2                (pay.ts:20)
```

Trigger: the fraud service answers slower than the 10 s client timeout.
Test sketch: `await Promise.all([paySplit("k1", …), paySplit("k1", …)])`,
then assert one row in `charges`. Fix: move the check and both INSERTs into
one `db.transaction(…).immediate()`, and replace `INSERT OR REPLACE` with a
plain `INSERT` so the primary key rejects a second write.
