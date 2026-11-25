# Kani (Rust)

Read in steps 1, 4, 5 and 7 of SKILL.md for a Rust crate.

## Install and check

```
cargo kani --version
```

Missing: ask the user, then `cargo install --locked kani-verifier` and `cargo kani setup`
(downloads a pinned nightly toolchain and CBMC into `~/.kani/`, about 1.5 GB). Kani
bundles CBMC: `~/.kani/kani-<version>/bin/cbmc` also serves the C route.

## Commands

| Goal | Command |
|---|---|
| list harnesses | `cargo kani list` |
| compile only | `cargo kani --only-codegen` |
| one harness | `<skill>/scripts/bmc-run.sh .bmc/<h>.log cargo kani --harness bmc_proofs::<h> --exact` |
| name the unreachable checks | `cargo kani --harness bmc_proofs::<h> --exact --output-format regular` to `.bmc/<h>.full.log`, then search it for `UNREACHABLE` |
| counterexample as a test | `cargo kani --harness <h> --exact -Z concrete-playback --concrete-playback=print` |
| write it into the source | `--concrete-playback=inplace` (adds a test inside the `cfg(kani)` module; run it with `cargo kani playback -Z concrete-playback`) |
| slow harness | `--solver kissat` or `--solver bitwuzla`; smaller bounds; report each change |

Add `[lints.rust] unexpected_cfgs = { level = "warn", check-cfg = ["cfg(kani)"] }` to
`Cargo.toml` so `cargo build` does not warn about `cfg(kani)`.

`bmc-run.sh` adds `--output-format terse` so each harness prints one summary block.
`--exact` needs the full path (`bmc_proofs::read_field_matches_layout`); `cargo kani list` prints it.

## Harness template

```rust
#[cfg(kani)]
mod bmc_proofs {
    use super::*;

    /// Rule R1 (verification/bmc-rules.md): read_field never panics, and a returned
    /// field is exactly the 2 bytes at `offset`, big-endian.
    #[kani::proof]
    #[kani::unwind(13)] // the target's scan loop runs at most N = 12 times; 12 + 1
    fn read_field_matches_layout() {
        // bound: 12 bytes = the 4-byte header + the 8-byte largest record the caller sends
        const N: usize = 12;
        let buf: [u8; N] = kani::any();
        let n: usize = kani::any();
        kani::assume(n <= N); // bound
        let offset: usize = kani::any(); // full range: offsets come from the wire
        let r = read_field(&buf[..n], offset);
        kani::cover!(true, "body reached");
        kani::cover!(r.is_none(), "rejected");
        kani::cover!(r.is_some(), "accepted");
        if let Some(v) = r {
            assert!(offset + 2 <= n);
            assert_eq!(v, u16::from_be_bytes([buf[offset], buf[offset + 1]]));
        }
    }
}
```

- Symbolic values: `kani::any::<T>()` for integers, bools, arrays, tuples and types that
  `#[derive(kani::Arbitrary)]`. Vectors: a symbolic array plus a symbolic length.
- Assumptions come in two kinds; label each one. A **bound** (`n <= N`) limits the size
  and is reported in the bounds column. A **precondition** (`low <= high`) excludes inputs
  and needs `// ASSUMES: <precondition> (<file:line> where it is enforced)`. A precondition
  that only a doc comment states stays, marked `(documented, not enforced)`, and is
  listed as an open question. One that nothing states is dropped.
- Assert `Ok`/`Some` before checking a value, or the check runs only on the error path.
- Unwind: one `#[kani::unwind(K)]` applies to every loop the harness runs. K = the
  largest iteration count over all of them, + 1: loops in the target (an inner loop
  capped by a guard counts at that cap), loops in the harness, and loops inside library
  calls (`==` on slices, `iter().sum()`, `contains`, `windows().all()`).
- `#[kani::should_panic]` inverts the harness; use it only when the rule is "this input
  must panic".

## Reading the output

`bmc-run.sh` prints the verdict. In the log:

- `** 1 of 58 failed (57 undetermined)` with `Failed Checks: unwinding assertion loop 0`:
  the bound is too low; every other check is undetermined, not passed.
- `** 0 of 3 cover properties satisfied (3 unreachable)` next to `VERIFICATION:- SUCCESSFUL`:
  the harness checked nothing.
- `Failed Checks: attempt to add with overflow`: an arithmetic overflow; Kani checks it in
  every build profile.
- `Found the following unsupported constructs` is a warning. Verification fails only if one
  of them is reachable; the failed check then names it.

## Counterexample to unit test

The playback output lists each symbolic value in the order `kani::any()` was called,
with the decoded value in a comment:

```
// 65536
vec![0, 0, 1, 0],
// 65536
vec![0, 0, 1, 0],
```

Write a plain test from those values, not the playback test (it needs the Kani toolchain):

```rust
#[test]
#[ignore = "BMC counterexample: attempt to multiply with overflow in area; remove when fixed"]
fn area_of_max_rect_is_refused() {
    // rule R3: area returns None when w * h does not fit in u32
    assert_eq!(area(65_536, 65_536), None); // panics today at src/geom.rs:12
}
```

Scalars: take the decoded value from each `// <value>ul` comment. A symbolic array plus
length `n`: use the first `n` bytes. A panic: the `#[test]` fails on the panic itself;
add the rule's assertion after the call for the day the panic is fixed.
