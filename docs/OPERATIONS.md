# Operations contract — M0 design baseline

No service is deployed by M0. Production commands remain disabled until identity verification and durable gameplay transactions pass M3 acceptance.

## Roles and controls

The first deployment target is a single server process with a Colyseus gateway, in-process sector authorities, PostgreSQL repositories and a bounded outbox worker. Separate process roles and Redis are introduced only after load evidence. Health endpoints distinguish liveness from readiness: readiness requires a loaded campaign, validated world and DB transaction ability. Admin map/rule publishing requires a separate permission, versioned change and audit trail.

## Observability

Capture connection count/disconnect reason; command receive, queue, validation and commit latency; acknowledgements and idempotency replay/conflict rates; per-sector queue depth; chunk revisions/resyncs; snapshot/delta sizes and outbound bytes; DB lock/transaction latency; outbox lag/retries; browser frame time and GPU memory. Logs use correlation/action IDs and omit tokens, raw student records and secret payloads.

## Failure and recovery drills

Test crash before commit, after commit before ack, and after ack before event delivery. In each case, replay the action and verify one business effect and a convergent client. Test stale writer fencing before distributed mode. During shutdown, stop new commands, drain in-flight commits, then close sockets. A degraded database makes mutations fail closed; it does not create an in-memory fallback wallet. Rollback of a binary or schema change requires an explicit compatibility plan and backup/restore rehearsal.

The deployment runbook, SLO alerts, backup retention, admin procedures and incident contacts will be filled with actual infrastructure and measured limits in M7. This document must not be treated as evidence that those procedures have been tested.
