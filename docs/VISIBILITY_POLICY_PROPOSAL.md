# Production visibility policy proposal — owner decision C-08

**Status: proposed, not an approved gameplay rule.** M2's executable synthetic rule is narrower: a test identity sees only its own school's presence bit and fog in subscribed chunks; no metadata, opposing presence or public overview is transmitted.

| Data | Public/unidentified | Same school | Opposing school | Spectator | Audited administrator |
|---|---|---|---|---|---|
| Map geometry and explicitly published HQ/Landmark locations | Proposed allow | Proposed allow | Proposed allow | Proposed allow | Proposed allow |
| Own school's discovered fog | Deny | Allow for authenticated member | Deny | Deny | Scoped operational access only |
| School knowledge/presence and strength on undiscovered cells | Deny | Proposed deny until own discovery | Deny | Deny | Scoped operational access only |
| School knowledge/presence on discovered cells | Deny until public disclosure rule approved | Own-school bit only as M2 safe baseline | Deny until owner defines competition visibility | Aggregated only if approved | Scoped operational access only |
| Other schools' raw mask bits, private timers, contest actions and metadata | Deny | Deny by default | Deny by default | Deny by default | Scoped operational access only |
| Player identity, balances and reward eligibility | Deny | Actor only | Deny | Deny | Role-specific audited access |

Owner decisions needed before M4: whether HQ/Landmarks pierce fog and at what detail; whether a school sees discovered cells after its Knowledge decays; which opponent contest facts become visible and when; spectator delay/aggregation; administrators' exact roles and audit retention. Every approved view needs a versioned policy, test fixtures for every actor type, and a review of snapshots, deltas, errors and logs. A public overview must be an explicitly derived coarse projection, never a raw full-world mask. M2 has no real student identities or production role claims.
