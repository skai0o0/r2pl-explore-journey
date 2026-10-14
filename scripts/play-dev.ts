/** Use the same PostgreSQL authority for local play and gameplay integration tests. */
// Existing disposable loopback fixture; explicit environment values still take precedence.
process.env.R2PL_BOT_DATABASE_URL ??=
  "postgresql://prep_fixture@127.0.0.1:55439/r2pl_prep_test_current";
process.env.R2PL_BOT_SIMULATION ??= "1";
await import("./play-schools.ts");

export {};
