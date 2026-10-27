import { SCHOOLS } from "../../shared/gameplay/gameConfig.ts";

type Api = <T>(path: string, body?: unknown, timeoutMs?: number) => Promise<T>;
type Student = {
  actorId: string;
  name: string;
  externalId: string;
  schoolId: string;
  balance: string;
};
type Entry = {
  kind: string;
  occurredAt: string;
  detail: Record<string, unknown>;
};
const labels: Record<string, string> = {
  running: "Kết quả đồng bộ chạy",
  "running-snapshot": "Quãng đường đồng bộ",
  points: "Biến động ví",
  event: "Hoạt động game",
  map: "Thay đổi bản đồ",
  note: "Ghi chú đối soát",
};
const path = "/api/admin/campaign";
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
export async function mountStudentHistory(
  content: HTMLElement,
  api: Api,
): Promise<void> {
  content.innerHTML = `<h2>Lịch sử sinh viên</h2><p>Tìm theo tên, mã sinh viên hoặc email đã liên kết. Dữ liệu đồng bộ chỉ phản ánh các snapshot web giải gửi sang, không xác định riêng từng buổi chạy. Lịch sử trước đây có thể không đầy đủ.</p><form class="history-search admin-form"><label>Tìm sinh viên<input name="query" required minlength="2" maxlength="100"></label><button class="admin-primary">Tìm</button></form><div class="history-results"></div><section class="history-detail"></section><p class="history-status" role="status" aria-live="polite"></p>`;
  const status = content.querySelector<HTMLElement>(".history-status")!;
  const results = content.querySelector<HTMLElement>(".history-results")!;
  const detail = content.querySelector<HTMLElement>(".history-detail")!;
  const form = content.querySelector<HTMLFormElement>(".history-search")!;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector("button")!;
    button.disabled = true;
    status.textContent = "Đang tìm…";
    try {
      const query = (
        form.elements.namedItem("query") as HTMLInputElement
      ).value.trim();
      const { students } = await api<{ students: Student[] }>(path, {
        action: "search",
        query,
      });
      results.replaceChildren();
      detail.replaceChildren();
      for (const s of students) {
        const school =
          SCHOOLS.find((v) => v.id === s.schoolId)?.shortName ?? s.schoolId;
        const choose = el(
          "button",
          `${s.name} · ${s.externalId} · ${school} · ${s.balance} điểm`,
        );
        choose.className = "admin-account-row";
        choose.onclick = () => {
          void show(s).catch((error) => {
            status.textContent = (error as Error).message;
          });
        };
        results.append(choose);
      }
      status.textContent = students.length
        ? `Tìm thấy ${students.length} sinh viên.`
        : "Không tìm thấy sinh viên.";
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      button.disabled = false;
    }
  };
  async function show(student: Student): Promise<void> {
    detail.replaceChildren(
      el("h3", `Lịch sử · ${student.name} · ${student.externalId}`),
    );
    const filters = document.createElement("form");
    filters.className = "admin-form";
    filters.innerHTML =
      '<label>Loại hoạt động<select name="kind"><option value="all">Tất cả</option><option value="running">Đồng bộ chạy</option><option value="points">Biến động ví</option><option value="event">Hoạt động game</option><option value="map">Bản đồ</option><option value="note">Ghi chú</option></select></label><label>Từ ngày<input type="date" name="from"></label><label>Đến ngày<input type="date" name="to"></label><button class="admin-primary">Lọc</button>';
    detail.append(filters);
    const entries = el("div", "");
    detail.append(entries);
    const more = el("button", "Xem thêm");
    more.className = "admin-primary";
    detail.append(more);
    const noteForm = document.createElement("form");
    noteForm.className = "admin-form";
    const label = el("label", "Ghi chú đối soát"),
      note = document.createElement("textarea");
    note.required = true;
    note.minLength = 3;
    note.maxLength = 1000;
    label.append(note);
    const save = el("button", "Lưu ghi chú");
    save.className = "admin-primary";
    noteForm.append(label, save);
    detail.append(noteForm);
    let offset = 0,
      noteKey = crypto.randomUUID(),
      pending = "";
    const load = async () => {
      more.disabled = true;
      try {
        const page = await api<{ entries: Entry[]; hasMore: boolean }>(path, {
          action: "history",
          actorId: student.actorId,
          offset,
          kind: (filters.elements.namedItem("kind") as HTMLSelectElement).value,
          from: (filters.elements.namedItem("from") as HTMLInputElement).value,
          to: (filters.elements.namedItem("to") as HTMLInputElement).value,
        });
        for (const item of page.entries) {
          const article = document.createElement("article");
          article.append(
            el("strong", labels[item.kind] ?? item.kind),
            el("p", new Date(item.occurredAt).toLocaleString("vi-VN")),
            el("pre", JSON.stringify(item.detail, null, 2)),
          );
          entries.append(article);
        }
        offset += page.entries.length;
        more.hidden = !page.hasMore;
        if (!offset) entries.append(el("p", "Chưa có lịch sử."));
      } finally {
        more.disabled = false;
      }
    };
    more.onclick = () => {
      void load().catch((error) => {
        status.textContent = (error as Error).message;
      });
    };
    filters.onsubmit = (event) => {
      event.preventDefault();
      offset = 0;
      entries.replaceChildren();
      void load().catch((error) => {
        status.textContent = (error as Error).message;
      });
    };
    noteForm.onsubmit = async (event) => {
      event.preventDefault();
      if (!noteForm.reportValidity()) return;
      const value = note.value.trim();
      if (pending && pending !== value) noteKey = crypto.randomUUID();
      pending = value;
      save.disabled = true;
      try {
        await api(path, {
          action: "note",
          key: noteKey,
          actorId: student.actorId,
          note: value,
        });
        noteKey = crypto.randomUUID();
        pending = "";
        try {
          await show(student);
          status.textContent = "Đã lưu ghi chú.";
        } catch {
          status.textContent =
            "Đã lưu ghi chú. Hãy chọn lại sinh viên để tải lịch sử.";
        }
      } catch (error) {
        status.textContent = (error as Error).message;
      } finally {
        save.disabled = false;
      }
    };
    await load();
  }
}
