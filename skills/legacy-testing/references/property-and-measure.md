# Property tests, then measure

## Property tests
Bugs hide in the edge cases. A property test generates many inputs and checks a rule that must always hold:
- money: a refund never exceeds what was paid; the parts add up to the total
- limits: seats sold never exceed seats available
- round trips: parse(format(x)) equals x

Write the rule in words first, then as a property. When it fails, the tool shrinks the input to the smallest failing case: add that case as a normal test too.

Done when each load-bearing rule in the area has a property test.

Official docs: fast-check https://fast-check.dev/ · Hypothesis https://hypothesis.readthedocs.io/ · jqwik https://jqwik.net/

## Measure
- **Coverage** shows which lines never ran. Use it to find blind spots, not as the target.
- **Mutation testing** shows which behaviour is never checked, even on covered lines: it plants small bugs and counts how many the tests catch. The mutation score on the load-bearing area is the target.

Run mutation testing on the target files only, explain every surviving mutant in one sentence, and add the test that kills it (or mark it as equivalent with the reason). The mutation-testing skill in this repo does exactly this.

Done when the mutation score on the target area meets the target in the approved plan.

Official docs: Stryker https://stryker-mutator.io/docs/ · Pitest https://pitest.org/ · mutmut https://mutmut.readthedocs.io/ · Vitest coverage https://vitest.dev/guide/coverage
