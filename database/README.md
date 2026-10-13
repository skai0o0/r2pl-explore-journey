# Database boundary

The durable M3/M3.5 baseline uses `migrations/001_m3_foundation.sql` and `002_m35_view_revisions.sql`, PostgreSQL transactions, idempotency receipts and an outbox. The live local launcher applies only these migrations.

`preparation/001_running_sync_dev.sql` is a separate, synthetic-only integration test schema (`r2pl_prep`). It is not part of the normal migration chain or production economy. The preparation PostgreSQL test applies it only with `R2PL_PREPARATION_DATABASE_URL` pointing to a loopback database named `r2pl_prep_test_*`. Accounts contain only `fixture-running-points`; approved production identity, conversion/correction rules and a reviewed migration are still required.

For full regression from an empty disposable database, set `R2PL_TEST_DATABASE_URL` to a loopback database named `r2pl_prep_test_*` and run `npm run test:postgres`. This guarded runner applies baseline migrations 001 and 002 before running the suite serially; `npm test` alone assumes those migrations already exist for the M3.5/M3.6 tests.
