import assert from "node:assert/strict";
import test from "node:test";
import { postPortalApi } from "../portal/csrfRequest.ts";

const stale = "a".repeat(64),
  fresh = "b".repeat(64);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const rejected = () => json({ error: "CSRF_REJECTED" }, 403);

test("stale-tab login and registration refresh CSRF once and preserve submitted credentials", async () => {
  for (const path of ["login", "register"]) {
    const calls: { path: string; init: RequestInit | undefined }[] = [];
    const session = { csrfToken: stale, student: null };
    const payload = {
      email: "synthetic@example.edu.vn",
      password: "synthetic-password",
    };
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ path: String(input), init });
      if (calls.length === 1) return rejected();
      if (calls.length === 2) return json({ csrfToken: fresh, student: null });
      return json({ ok: true });
    };
    assert.deepEqual(await postPortalApi(path, payload, session, fetcher), {
      ok: true,
    });
    assert.deepEqual(
      calls.map((c) => c.path),
      [`/api/dummy/v1/${path}`, "/api/dummy/v1/me", `/api/dummy/v1/${path}`],
    );
    assert.equal(
      new Headers(calls[0]!.init?.headers).get("X-CSRF-Token"),
      stale,
    );
    assert.equal(
      new Headers(calls[2]!.init?.headers).get("X-CSRF-Token"),
      fresh,
    );
    assert.equal(calls[0]!.init?.body, calls[2]!.init?.body);
    assert.equal(calls[1]!.init?.cache, "no-store");
  }
});

test("a persistent CSRF rejection stops after one retry", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () =>
    ++calls === 2 ? json({ csrfToken: fresh, student: null }) : rejected();
  await assert.rejects(
    postPortalApi("login", {}, { csrfToken: stale, student: null }, fetcher),
    /cookie/,
  );
  assert.equal(calls, 3);
});

test("a stale activity cannot be replayed under a different or logged-out student", async () => {
  for (const student of [{ id: "student-b" }, null]) {
    let calls = 0;
    const fetcher: typeof fetch = async () =>
      ++calls === 1 ? rejected() : json({ csrfToken: fresh, student });
    await assert.rejects(
      postPortalApi(
        "activities",
        { meters: 1000 },
        { csrfToken: stale, student: { id: "student-a" } },
        fetcher,
      ),
      /Phiên đăng nhập đã thay đổi/,
    );
    assert.equal(calls, 2);
  }
});

test("same-student token refresh can recover without duplicating an accepted activity", async () => {
  let calls = 0;
  const session = { csrfToken: stale, student: { id: "student-a" } };
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1) return rejected();
    if (calls === 2)
      return json({ csrfToken: fresh, student: session.student });
    return json({ queued: true });
  };
  assert.deepEqual(
    await postPortalApi(
      "activities",
      { id: "stable-activity-id", meters: 1000 },
      session,
      fetcher,
    ),
    { queued: true },
  );
  assert.equal(calls, 3);
});

test("incorrect credentials never trigger CSRF refresh or a second login", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return json({ error: "INVALID_CREDENTIALS" }, 401);
  };
  await assert.rejects(
    postPortalApi("login", {}, { csrfToken: stale, student: null }, fetcher),
    /INVALID_CREDENTIALS/,
  );
  assert.equal(calls, 1);
});
