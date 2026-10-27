import { GAME_CONFIG, SCHOOLS } from "../../shared/gameplay/gameConfig.ts";

type Api = <T>(path: string, body?: unknown, timeoutMs?: number) => Promise<T>;
type Pool = { schoolId: string; schoolName: string; balance: string | null };
type Student = {
  actorId: string;
  name: string;
  externalId: string;
  schoolId: string;
  balance: string;
  email: string | null;
};
const path = "/api/admin/campaign";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function mountCampaignAdmin(
  content: HTMLElement,
  api: Api,
): Promise<void> {
  const { pools } = await api<{ pools: Pool[] }>(path);
  content.innerHTML = `<h2>Dữ liệu chiến dịch</h2><p>Chỉ tài khoản admin@amtech.vn được sử dụng trang này. Mọi thay đổi đều được ghi vào lịch sử quản trị.</p><section><h3>Điểm của 8 hồ sơ test</h3><p>Mỗi trường có một ví chung cho tất cả tài khoản dùng hồ sơ test của trường đó.</p><div class="campaign-pools"></div></section><section><h3>Điểm của sinh viên</h3><p>Tìm theo tên, mã sinh viên hoặc email đã liên kết.</p><form class="campaign-search"><label>Tìm sinh viên <input name="query" minlength="2" maxlength="100" required></label><button class="admin-primary">Tìm</button></form><div class="campaign-students"></div></section><section><h3>Reset chiến dịch</h3><p>Đưa bản đồ, điểm và tiến độ về trạng thái ban đầu, bao gồm cả 8 ví test. Tài khoản, dữ liệu đồng bộ giải chạy, quà thật và bố cục đối tượng được giữ lại. Người chơi cần đăng nhập lại.</p><p>Hệ thống sẽ sao lưu dữ liệu trước khi reset. Nhập RESET để xác nhận.</p><form class="campaign-reset"><label>Xác nhận <input name="confirmation" autocomplete="off" required></label><button class="admin-primary">Reset bản đồ, điểm và tiến độ</button></form></section><p class="campaign-status" role="status" aria-live="polite"></p>`;
  const status = content.querySelector<HTMLElement>(".campaign-status")!;
  const poolList = content.querySelector<HTMLElement>(".campaign-pools")!;
  const studentList = content.querySelector<HTMLElement>(".campaign-students")!;
  let resetKey = crypto.randomUUID();
  const row = (
    title: string,
    initial: string | null,
    target: Record<string, string>,
  ) => {
    const form = element("form");
    form.className = "admin-form campaign-balance";
    const label = element("label", title);
    const input = element("input");
    input.type = "number";
    input.min = "0";
    input.max = String(GAME_CONFIG.campaignAdmin.maxPoints);
    input.step = "1";
    input.required = true;
    const button = element("button", "Lưu điểm");
    button.className = "admin-primary";
    let current = initial;
    if (current === null) {
      label.append(element("span", " — Chưa có ví test"));
      input.disabled = true;
      button.disabled = true;
    } else input.value = current;
    label.append(input);
    form.append(label, button);
    const reason = element("input");
    if (target.action === "set_student") {
      reason.placeholder = "Lý do điều chỉnh";
      reason.minLength = 3;
      reason.maxLength = 500;
      reason.required = true;
      const reasonLabel = element("label", "Lý do");
      reasonLabel.append(reason);
      button.before(reasonLabel);
    }
    let key = crypto.randomUUID();
    let pending = "";
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (current === null || !form.reportValidity()) return;
      const desired = input.value;
      const signature = `${current}:${desired}:${reason.value}`;
      if (pending && pending !== signature) key = crypto.randomUUID();
      pending = signature;
      button.disabled = true;
      status.textContent = "Đang lưu điểm…";
      try {
        const result = await api<{ balance: string }>(path, {
          ...target,
          key,
          balance: desired,
          expectedBalance: current,
          ...(target.action === "set_student"
            ? { reason: reason.value.trim() }
            : {}),
        });
        current = result.balance;
        input.value = current;
        key = crypto.randomUUID();
        pending = "";
        status.textContent = "Đã lưu điểm.";
        reason.value = "";
      } catch (error) {
        status.textContent = (error as Error).message;
      } finally {
        button.disabled = false;
      }
    };
    return form;
  };
  for (const pool of pools)
    poolList.append(
      row(pool.schoolName, pool.balance, {
        action: "set_pool",
        schoolId: pool.schoolId,
      }),
    );
  const search = content.querySelector<HTMLFormElement>(".campaign-search")!;
  search.onsubmit = async (event) => {
    event.preventDefault();
    if (!search.reportValidity()) return;
    const button = search.querySelector("button")!;
    button.disabled = true;
    status.textContent = "Đang tìm…";
    try {
      const query = (
        search.elements.namedItem("query") as HTMLInputElement
      ).value.trim();
      const { students } = await api<{ students: Student[] }>(path, {
        action: "search",
        query,
      });
      studentList.replaceChildren();
      for (const student of students) {
        const school =
          SCHOOLS.find((s) => s.id === student.schoolId)?.shortName ??
          student.schoolId;
        studentList.append(
          row(
            `${student.name} · ${school} · ${student.externalId}${student.email ? ` · ${student.email}` : ""}`,
            student.balance,
            { action: "set_student", actorId: student.actorId },
          ),
        );
      }
      status.textContent = students.length
        ? `Tìm thấy ${students.length} tài khoản.`
        : "Không tìm thấy sinh viên.";
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      button.disabled = false;
    }
  };
  const reset = content.querySelector<HTMLFormElement>(".campaign-reset")!;
  reset.onsubmit = async (event) => {
    event.preventDefault();
    const confirmation = (
      reset.elements.namedItem("confirmation") as HTMLInputElement
    ).value;
    if (confirmation !== "RESET") {
      status.textContent = "Hãy nhập đúng RESET để xác nhận.";
      return;
    }
    if (
      !confirm(
        "Reset toàn bộ bản đồ, điểm và tiến độ? Người chơi sẽ phải đăng nhập lại.",
      )
    )
      return;
    const button = reset.querySelector("button")!;
    button.disabled = true;
    status.textContent = "Đang sao lưu và reset. Vui lòng chờ…";
    try {
      await api(
        path,
        { action: "reset", key: resetKey, confirmation },
        GAME_CONFIG.campaignAdmin.requestTimeoutMs,
      );
      resetKey = crypto.randomUUID();
      try {
        await mountCampaignAdmin(content, api);
        content.querySelector<HTMLElement>(".campaign-status")!.textContent =
          "Đã sao lưu và reset chiến dịch. Người chơi cần đăng nhập lại.";
      } catch {
        status.textContent =
          "Đã sao lưu và reset chiến dịch. Tải lại trang để xem số dư mới; người chơi cần đăng nhập lại.";
        reset.remove();
        return;
      }
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      button.disabled = false;
    }
  };
}
