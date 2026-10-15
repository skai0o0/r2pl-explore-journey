let portalCsrf: string | undefined;
export function configureGameHttp(csrf: string): void {
  portalCsrf = csrf;
}
export function gameFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (portalCsrf) {
    headers.delete("Authorization");
    if (!["GET", "HEAD"].includes(init.method ?? "GET"))
      headers.set("X-CSRF-Token", portalCsrf);
  }
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
