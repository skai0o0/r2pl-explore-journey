# Operations contract — M0 design baseline

No service is deployed by M0. Production commands remain disabled until identity verification and durable gameplay transactions pass M3 acceptance.

## Roles and controls

The first deployment target is a single server process with a Colyseus gateway, in-process sector authorities, PostgreSQL repositories and a bounded outbox worker. Separate process roles and Redis are introduced only after load evidence. Health endpoints distinguish liveness from readiness: readiness requires a loaded campaign, validated world and DB transaction ability. Admin map/rule publishing requires a separate permission, versioned change and audit trail.

## Observability

Capture connection count/disconnect reason; command receive, queue, validation and commit latency; acknowledgements and idempotency replay/conflict rates; per-sector queue depth; chunk revisions/resyncs; snapshot/delta sizes and outbound bytes; DB lock/transaction latency; outbox lag/retries; browser frame time and GPU memory. Logs use correlation/action IDs and omit tokens, raw student records and secret payloads.

## Failure and recovery drills

Test crash before commit, after commit before ack, and after ack before event delivery. In each case, replay the action and verify one business effect and a convergent client. Test stale writer fencing before distributed mode. During shutdown, stop new commands, drain in-flight commits, then close sockets. A degraded database makes mutations fail closed; it does not create an in-memory fallback wallet. Rollback of a binary or schema change requires an explicit compatibility plan and backup/restore rehearsal.

The deployment runbook, SLO alerts, backup retention, admin procedures and incident contacts will be filled with actual infrastructure and measured limits in M7. This document must not be treated as evidence that those procedures have been tested.

## Host game builds and embed them in a website

Use this flow for HTML5/client-side games. Keep server-side APIs, databases and WebSockets on their own backend; an iframe only embeds the browser client and does not move backend traffic to the static host.

1. Prepare a self-contained web build with `index.html` and its assets using relative paths. Keep API keys and server secrets out of the client bundle.
2. Choose a host:
   - **itch.io:** zip the HTML5 package with `index.html` at its root, upload it as an HTML game, set the embed dimensions, then publish. Use the public game page URL or the published HTML5 URL as the iframe source.
   - **Vercel:** copy the build output into the linked static project directory, deploy a Preview first, test it, then deploy the accepted build to that project's Production alias. For this R2PL test, `artifacts/vercel-demo/index.html` is the static wrapper and `https://r2pl-demo-embed.vercel.app/` is its public URL.
3. Embed the chosen public URL in the parent page with a responsive iframe (`width: 100%`, an explicit/minimum height, `allowfullscreen`, and an accessible `title`). Include a direct-open link as a fallback. The sample parent page is `artifacts/itch-html5/dummy.html`.
4. Test the direct URL and the iframe on desktop and mobile. Check browser console/network for frame-policy, API, WebSocket, authentication/cookie, audio and fullscreen issues. The hosted page must permit the intended parent origin in CSP `frame-ancestors`; remove conflicting `X-Frame-Options` when cross-site embedding is intended. Configure CORS separately for cross-origin API requests, and do not rely on third-party cookies without testing the target browsers.

The current R2PL Vercel deployment is an embed wrapper around `https://play.skai0o0.id.vn/`, not a standalone game build. The Demo still serves the game client, models, API and WebSocket traffic. It is isolated in the Vercel project `r2pl-demo-embed`; its Production alias does not deploy or change the R2PL Production game. The itch.io HTML5 package is also a wrapper around the Demo. These examples validate embedding, not independent game hosting or backend capacity.
