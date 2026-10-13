import assert from "node:assert/strict";
import { test } from "node:test";
import { disposableDatabaseUrl } from "../scripts/migrate-m4d2.ts";

const QA_REF = "asthukrgcnbskbhhjiiu";
const BASE = "aws-0-ap-southeast-1.pooler.supabase.com";

test("M4-D2 allows only approved Supabase QA pooler, TLS required", () => {
  const approved = `postgresql://postgres.${QA_REF}:test-password@${BASE}:5432/postgres?sslmode=require`;
  assert.equal(disposableDatabaseUrl(approved), approved);
  const direct = `postgresql://postgres:test-password@db.${QA_REF}.supabase.co:5432/postgres?sslmode=require`;
  assert.equal(disposableDatabaseUrl(direct), direct);
  assert.throws(() =>
    disposableDatabaseUrl(approved.replace("sslmode=require", "")),
  );
});

test("M4-D2 rejects historical land-rush-prototype and arbitrary cloud databases", () => {
  const legacy = `postgresql://postgres.bvgyaauigbtdtbafiskp:test-password@${BASE}:5432/postgres?sslmode=require`;
  assert.throws(() => disposableDatabaseUrl(legacy));
  assert.throws(() =>
    disposableDatabaseUrl(
      "postgresql://postgres:password@db.bvgyaauigbtdtbafiskp.supabase.co:5432/postgres?sslmode=require",
    ),
  );
  assert.throws(() =>
    disposableDatabaseUrl(
      "postgresql://postgres:password@evil.example.com:5432/postgres?sslmode=require",
    ),
  );
  assert.throws(() =>
    disposableDatabaseUrl(
      `postgresql://postgres.${QA_REF}:test-password@${BASE}:6543/postgres?sslmode=require`,
    ),
  );
});

test("M4-D2 allows clearly named local disposable databases only", () => {
  const local = "postgresql://tester:password@127.0.0.1:5432/r2pl_test";
  assert.equal(disposableDatabaseUrl(local), local);
  assert.throws(() =>
    disposableDatabaseUrl(
      "postgresql://tester:password@127.0.0.1:5432/postgres",
    ),
  );
  assert.throws(() =>
    disposableDatabaseUrl(
      "postgresql://tester:password@localhost:5432/production",
    ),
  );
});
