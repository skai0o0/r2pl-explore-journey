interface PortalSession {
  csrfToken: string;
  student: { id: string } | null;
}

/** Recover stale tab tokens without replaying a mutation under another student. */
export async function postPortalApi(
  path: string,
  body: unknown,
  session: PortalSession,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const studentId = session.student?.id ?? null;
  const encoded = JSON.stringify(body);
  const send = async () => {
    const response = await fetcher(`/api/dummy/v1/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      },
      body: encoded,
      signal: AbortSignal.timeout(20000),
    });
    return {
      response,
      result: (await response.json()) as Record<string, unknown>,
    };
  };
  let reply = await send();
  if (reply.response.status === 403 && reply.result.error === "CSRF_REJECTED") {
    const response = await fetcher("/api/dummy/v1/me", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error("Chưa làm mới được phiên. Vui lòng tải lại Portal.");
    const fresh = (await response.json()) as PortalSession;
    if (
      !fresh ||
      typeof fresh.csrfToken !== "string" ||
      !/^[a-f0-9]{64}$/.test(fresh.csrfToken)
    )
      throw new Error("Chưa làm mới được phiên. Vui lòng tải lại Portal.");
    if (
      !["login", "register"].includes(path) &&
      (fresh.student?.id ?? null) !== studentId
    )
      throw new Error(
        "Phiên đăng nhập đã thay đổi. Vui lòng tải lại Portal và kiểm tra tài khoản trước khi thử lại.",
      );
    session.csrfToken = fresh.csrfToken;
    reply = await send();
  }
  if (!reply.response.ok) {
    if (reply.result.error === "CSRF_REJECTED")
      throw new Error(
        "Chưa xác minh được phiên. Vui lòng cho phép cookie và tải lại Portal.",
      );
    throw new Error(
      String(reply.result.error ?? "Chưa thể kết nối. Vui lòng thử lại."),
    );
  }
  return reply.result;
}
