import {
  EDITOR_CONFIG,
  type EditorSnapshot,
  placementError,
  validateEditorLayout,
} from "../../shared/gameplay/editor.ts";
import {
  GAME_CONFIG,
  type WorldObject,
} from "../../shared/gameplay/gameConfig.ts";
import type { AdminPrincipal } from "../../shared/integration/identity.ts";
import { finishBoot } from "./bootScreen.ts";
import { EditorScene } from "./editorScene.ts";
import { gameFetch } from "./gameHttp.ts";
import { mountGiftPoolEditor } from "./giftPoolEditor.ts";
import { fetchModelManifest } from "./modelManifest.ts";
import { returnToEventPortal } from "./portalSession.ts";
import "./liveEditor.css";

const labels = {
  hq: "Trụ sở",
  landmark: "Công trình",
  unistop: "UniStop",
  chest: "Rương",
};
const glyphs = { hq: "▥", landmark: "◆", unistop: "◈", chest: "▣" };
const messages: Record<string, string> = {
  LAYOUT_VERSION_CONFLICT:
    "Bản đồ đã được admin khác cập nhật. Bản nháp của bạn vẫn còn; tải bản mới trước khi xuất bản.",
  DRAFT_VERSION_CONFLICT:
    "Bản nháp đã thay đổi ở cửa sổ khác. Hãy mở lại bản nháp đã lưu.",
  ADMIN_REQUIRED: "Bạn không còn quyền quản trị. Vui lòng đăng nhập lại.",
  CSRF_REJECTED: "Phiên đăng nhập đã thay đổi. Vui lòng tải lại trang.",
  STAGING_ONLY: "Chức năng này chỉ có ở môi trường thử nghiệm.",
};
export async function mountLiveEditor(
  principal: AdminPrincipal,
  environment: "staging" | "production",
): Promise<void> {
  document.title = "R2PL Studio · Live Editor";
  document.body.dataset.mode = "admin";
  document.body.dataset.debug = "false";
  const app = document.createElement("main");
  app.className = "studio";
  app.innerHTML = `<header class="studio-header"><a class="studio-brand" href="/">R² <span>STUDIO<small>KHÔNG GIAN QUẢN TRỊ</small></span></a><span class="studio-environment"></span><div class="studio-actions"><button data-action="undo" title="Ctrl+Z">↶ Hoàn tác</button><button data-action="redo" title="Ctrl+Shift+Z">↷ Làm lại</button><button data-action="save">Lưu bản nháp</button><button data-action="publish" class="studio-primary">Xuất bản ↗</button><button data-action="logout">Đăng xuất</button></div></header>
  <aside class="studio-library"><p class="studio-eyebrow">THƯ VIỆN VẬT THỂ</p><h1>Thiết kế hành trình</h1><p class="studio-muted">Kéo vật thể vào bản đồ hoặc chọn rồi bấm nơi muốn đặt.</p><div class="studio-palette"></div><label>Tìm trên bản đồ<input type="search" class="studio-search" placeholder="Tên trường, công trình…"></label><div class="studio-filters" role="group" aria-label="Loại vật thể"></div><div class="studio-object-list"></div></aside>
  <section class="studio-viewport" aria-label="Không gian chỉnh sửa"><div class="studio-map"></div><div class="studio-map-toolbar"><button data-action="overview">Toàn bản đồ</button><button data-action="camera">Đổi góc nhìn</button><button data-action="zoom-in" aria-label="Phóng to">＋</button><button data-action="zoom-out" aria-label="Thu nhỏ">−</button><button data-action="cancel">Bỏ chọn / Esc</button></div><div class="studio-map-caption">BẢN NHÁP · Kéo vật thể để di chuyển · Cuộn để zoom · Kéo nền để xem bản đồ</div></section>
  <aside class="studio-inspector"><p class="studio-eyebrow">THUỘC TÍNH</p><div class="studio-properties"></div><hr><details open><summary>Phiên bản & bản nháp</summary><p class="studio-version"></p><button data-action="load">Tải bản đang chạy</button><button data-action="recover">Mở bản nháp đã lưu</button><div class="studio-history"></div></details><hr><details><summary>Thông báo campaign</summary><form class="studio-notify"><label>Tiêu đề<input name="title" maxlength="100" required></label><label>Nội dung<textarea name="body" maxlength="500" required></textarea></label><button type="submit">Gửi thông báo</button></form></details><hr><details><summary>Tra cứu & phát quà</summary><form class="studio-gifts"><label>Mã quà<input name="code" placeholder="R2PL-GIFT-…" required></label><button type="submit">Tra cứu</button></form><button data-action="gifts">Quà gần đây</button><div class="studio-gift-results"></div></details><hr><details><summary>Pool quà thật</summary><div class="studio-gift-pool"></div></details></aside>
  <footer class="studio-footer"><span class="studio-user"></span><span class="studio-status" role="status" aria-live="polite">Đang tải bản đồ…</span><span class="studio-count"></span></footer>`;
  document.querySelector(".game-shell")?.remove();
  document.querySelector(".map-tools")?.remove();
  document.body.append(app);
  const el = <T extends HTMLElement>(selector: string) =>
    app.querySelector<T>(selector)!;
  el(".studio-user").textContent = `${principal.name} · AMTECH · Admin`;
  el(".studio-environment").textContent =
    environment === "staging" ? "● THỬ NGHIỆM" : "● CAMPAIGN CHÍNH THỨC";
  let objects: WorldObject[] = [],
    selected: string | undefined,
    baseRevision = 0,
    draftRevision = 0,
    dirty = false,
    unsaved = false,
    busy = false;
  let filter = "all",
    snapshot: EditorSnapshot | undefined;
  const undo: WorldObject[][] = [],
    redo: WorldObject[][] = [];
  const clone = (value: WorldObject[]) => structuredClone(value);
  const status = (text: string, error = false) => {
    el(".studio-status").textContent = text;
    el(".studio-status").dataset.error = String(error);
  };
  function ask(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "studio-confirm";
      dialog.setAttribute("aria-labelledby", "studio-confirm-title");
      const title = document.createElement("h2"),
        text = document.createElement("p"),
        row = document.createElement("div"),
        cancel = document.createElement("button"),
        accept = document.createElement("button");
      title.id = "studio-confirm-title";
      title.textContent = "Xác nhận thao tác";
      text.textContent = message;
      cancel.textContent = "Quay lại";
      accept.textContent = "Xác nhận";
      accept.className = "studio-primary";
      row.append(cancel, accept);
      dialog.append(title, text, row);
      app.append(dialog);
      const finish = (ok: boolean) => {
        dialog.close();
        dialog.remove();
        resolve(ok);
      };
      cancel.onclick = () => finish(false);
      accept.onclick = () => finish(true);
      dialog.oncancel = (event) => {
        event.preventDefault();
        finish(false);
      };
      dialog.showModal();
      cancel.focus();
    });
  }
  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await gameFetch(path, {
      cache: "no-store",
      signal: AbortSignal.timeout(GAME_CONFIG.integration.bootstrapTimeoutMs),
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(
        messages[result.error ?? ""] ??
          result.error ??
          `Yêu cầu không thành công (${response.status}).`,
      );
    return result as T;
  }
  async function action(work: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    el(".studio-map").style.pointerEvents = "none";
    for (const b of Array.from(
      app.querySelectorAll<HTMLButtonElement>("button"),
    ))
      b.disabled = true;
    try {
      await work();
    } catch (error) {
      status(
        error instanceof Error
          ? error.message
          : "Chưa thể kết nối. Bản chỉnh sửa vẫn được giữ trên màn hình.",
        true,
      );
    } finally {
      busy = false;
      el(".studio-map").style.pointerEvents = "";
      for (const b of Array.from(
        app.querySelectorAll<HTMLButtonElement>("button"),
      ))
        b.disabled = false;
      renderControls();
    }
  }
  await fetchModelManifest();
  const scene = new EditorScene(
    el(".studio-map"),
    (id) => {
      selected = id;
      renderProperties();
      renderList();
    },
    (object) => {
      mutate(
        objects.some((o) => o.id === object.id)
          ? objects.map((o) => (o.id === object.id ? object : o))
          : [...objects, object],
      );
    },
    status,
  );
  function mutate(next: WorldObject[]): void {
    if (busy) return;
    try {
      validateEditorLayout(next);
    } catch (error) {
      status((error as Error).message, true);
      scene.setObjects(objects);
      return;
    }
    if (JSON.stringify(next) === JSON.stringify(objects)) return;
    undo.push(clone(objects));
    if (undo.length > EDITOR_CONFIG.maxUndo) undo.shift();
    redo.length = 0;
    objects = clone(next);
    dirty = true;
    unsaved = true;
    refresh();
    status("Đã chỉnh sửa bản nháp. Bấm Xuất bản để áp dụng cho người chơi.");
  }
  function renderControls(): void {
    el<HTMLButtonElement>('[data-action="undo"]').disabled =
      busy || !undo.length;
    el<HTMLButtonElement>('[data-action="redo"]').disabled =
      busy || !redo.length;
    el(".studio-version").textContent =
      `Bản nền v${baseRevision} · ${dirty ? "Có thay đổi chưa xuất bản" : "Đã đồng bộ"}`;
    el(".studio-count").textContent = `${objects.length} vật thể · 8 trường`;
  }
  function refresh(): void {
    scene.setObjects(objects);
    scene.select(selected);
    renderList();
    renderProperties();
    renderControls();
  }
  function renderList(): void {
    const list = el(".studio-object-list");
    list.replaceChildren();
    const query = el<HTMLInputElement>(".studio-search")
      .value.trim()
      .toLocaleLowerCase("vi");
    for (const o of objects.filter(
      (o) =>
        (filter === "all" || o.kind === filter) &&
        o.name.toLocaleLowerCase("vi").includes(query),
    )) {
      const b = document.createElement("button");
      b.className = "studio-object";
      b.dataset.selected = String(o.id === selected);
      const icon = document.createElement("span"),
        text = document.createElement("span"),
        name = document.createElement("strong"),
        sub = document.createElement("small");
      icon.className = "studio-object-icon";
      icon.textContent = glyphs[o.kind];
      name.textContent = o.name;
      sub.textContent = `${labels[o.kind]} · ${o.x}, ${o.z}`;
      text.append(name, sub);
      b.append(icon, text);
      b.onclick = () => {
        selected = o.id;
        scene.select(o.id);
        scene.focus(o.x, o.z);
        renderProperties();
        renderList();
      };
      list.append(b);
    }
  }
  function renderProperties(): void {
    const panel = el(".studio-properties"),
      o = objects.find((p) => p.id === selected);
    panel.replaceChildren();
    if (!o) {
      const p = document.createElement("p");
      p.className = "studio-empty";
      p.textContent =
        "Chọn một vật thể trên bản đồ để chỉnh sửa. Trụ sở và công trình được bảo vệ khỏi xóa.";
      panel.append(p);
      return;
    }
    const title = document.createElement("h2");
    title.textContent = o.name;
    panel.append(title);
    const form = document.createElement("form");
    form.innerHTML = `<label>Tên hiển thị<input name="name" required maxlength="100"></label><div class="studio-coordinates"><label>Ô X<input name="x" type="number" step="1" required></label><label>Ô Z<input name="z" type="number" step="1" required></label></div>${o.kind === "unistop" || o.kind === "chest" ? '<label>Hạng<select name="tier"><option>aspire</option><option>nitro</option><option>predator</option></select></label>' : ""}<p class="studio-muted">Diện tích: ${o.width} × ${o.height} ô</p><button type="submit">Áp dụng vào bản nháp</button>`;
    (form.elements.namedItem("name") as HTMLInputElement).value = o.name;
    (form.elements.namedItem("x") as HTMLInputElement).value = String(o.x);
    (form.elements.namedItem("z") as HTMLInputElement).value = String(o.z);
    if (form.elements.namedItem("tier"))
      (form.elements.namedItem("tier") as HTMLSelectElement).value = o.tier!;
    form.onsubmit = (event) => {
      event.preventDefault();
      const fields = new FormData(form);
      const next = {
        ...o,
        name: String(fields.get("name")).trim(),
        x: Number(fields.get("x")),
        z: Number(fields.get("z")),
        ...(fields.has("tier")
          ? {
              tier: String(fields.get("tier")) as NonNullable<
                WorldObject["tier"]
              >,
            }
          : {}),
      };
      const error = placementError(next, objects);
      if (error) {
        status(error, true);
        return;
      }
      mutate(objects.map((p) => (p.id === o.id ? next : p)));
    };
    panel.append(form);
    if (["unistop", "chest"].includes(o.kind)) {
      const copy = document.createElement("button");
      copy.textContent = "Nhân bản & chọn vị trí";
      copy.onclick = () => {
        scene.beginPlacement({
          ...o,
          id: `${o.kind}-${crypto.randomUUID()}`,
          name: `${o.name} (bản sao)`,
          ownerSchoolSlot: null,
          ownerSchoolId: null,
        });
        status("Bấm một vị trí trống để đặt bản sao.");
      };
      const del = document.createElement("button");
      del.className = "studio-danger";
      del.textContent = "Xóa khỏi bản nháp";
      del.onclick = () => {
        mutate(objects.filter((p) => p.id !== o.id));
        selected = undefined;
        scene.select(undefined);
        renderProperties();
      };
      panel.append(copy, del);
    } else {
      const p = document.createElement("p");
      p.className = "studio-muted";
      p.textContent =
        o.kind === "hq"
          ? "Trụ sở được bảo vệ. Server kiểm tra lãnh thổ khi di chuyển."
          : "Công trình thuộc bộ 10 địa danh cố định.";
      panel.append(p);
    }
  }
  function history(): void {
    const list = el(".studio-history");
    list.replaceChildren();
    for (const v of snapshot?.history ?? []) {
      const b = document.createElement("button");
      b.textContent = `v${v.revision} · ${v.actor}`;
      b.title = new Date(v.createdAt).toLocaleString("vi-VN");
      b.onclick = async () => {
        if (
          unsaved &&
          !(await ask(
            "Khôi phục phiên bản sẽ thay thế phần chưa xuất bản trên màn hình. Tiếp tục?",
          ))
        )
          return;
        if (
          !(await ask(
            `Xuất bản lại bố cục v${v.revision}? Tiến trình người chơi vẫn được giữ.`,
          ))
        )
          return;
        void action(async () => {
          await request("/api/admin", {
            action: "rollback",
            baseRevision,
            targetRevision: v.revision,
          });
          await load();
          status("Đã khôi phục bố cục và tạo phiên bản mới.");
        });
      };
      list.append(b);
    }
  }
  async function load(): Promise<void> {
    snapshot = await request<EditorSnapshot>("/api/admin/editor");
    objects = clone(snapshot.objects);
    baseRevision = snapshot.revision;
    draftRevision = snapshot.draft?.revision ?? 0;
    dirty = false;
    unsaved = false;
    undo.length = redo.length = 0;
    refresh();
    history();
  }
  const palette = el(".studio-palette");
  for (const kind of ["unistop", "chest"] as const)
    for (const tier of ["aspire", "nitro", "predator"] as const) {
      const b = document.createElement("button");
      b.draggable = true;
      b.className = "studio-palette-item";
      const icon = document.createElement("span"),
        text = document.createElement("span"),
        small = document.createElement("small");
      icon.textContent = glyphs[kind];
      text.textContent = labels[kind];
      small.textContent = tier;
      b.append(icon, text, small);
      const begin = () => {
        if (busy) return;
        scene.beginPlacement({
          id: `${kind}-${crypto.randomUUID()}`,
          kind,
          tier,
          name: `${labels[kind]} ${tier}`,
          x: 500,
          z: 500,
          ...GAME_CONFIG.footprints[kind],
        });
        status("Chọn vị trí đặt trên bản đồ. Esc để hủy.");
      };
      b.onclick = begin;
      b.ondragstart = (e) => {
        begin();
        e.dataTransfer?.setData("text/plain", kind);
      };
      palette.append(b);
    }
  for (const [id, label] of [["all", "Tất cả"], ...Object.entries(labels)] as [
    string,
    string,
  ][]) {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.active = String(id === filter);
    b.onclick = () => {
      filter = id!;
      for (const peer of Array.from(el(".studio-filters").children))
        (peer as HTMLElement).dataset.active = String(peer === b);
      renderList();
    };
    el(".studio-filters").append(b);
  }
  el<HTMLInputElement>(".studio-search").oninput = renderList;
  const click = (name: string, handler: () => void) => {
    el<HTMLButtonElement>(`[data-action="${name}"]`).onclick = handler;
  };
  const undoRedo = (from: WorldObject[][], to: WorldObject[][]) => {
    if (busy || !from.length) return;
    to.push(clone(objects));
    objects = from.pop()!;
    dirty = true;
    unsaved = true;
    refresh();
    status("Đã cập nhật bản nháp.");
  };
  click("undo", () => undoRedo(undo, redo));
  click("redo", () => undoRedo(redo, undo));
  click(
    "save",
    () =>
      void action(async () => {
        const result = await request<{ revision: number }>(
          "/api/admin/editor/draft",
          { objects, baseRevision, draftRevision },
        );
        draftRevision = result.revision;
        unsaved = false;
        status("Đã lưu bản nháp. Bản đồ người chơi chưa thay đổi.");
      }),
  );
  click("publish", async () => {
    if (!(await ask("Xuất bản bố cục này cho người chơi?"))) return;
    void action(async () => {
      await request("/api/admin", { action: "publish", objects, baseRevision });
      await load();
      status("Đã xuất bản. Bản đồ người chơi đang đồng bộ phiên bản mới.");
    });
  });
  click("load", async () => {
    if (
      unsaved &&
      !(await ask("Bỏ các thay đổi chưa xuất bản để tải bản đang chạy?"))
    )
      return;
    void action(async () => {
      await load();
      status("Đã tải bản đang chạy.");
    });
  });
  click("recover", async () => {
    if (
      unsaved &&
      !(await ask("Thay thế thay đổi trên màn hình bằng bản nháp đã lưu?"))
    )
      return;
    void action(async () => {
      const page = await request<EditorSnapshot>("/api/admin/editor");
      if (!page.draft) {
        status("Chưa có bản nháp đã lưu.");
        return;
      }
      undo.push(clone(objects));
      redo.length = 0;
      objects = clone(page.draft.objects);
      baseRevision = page.draft.baseRevision;
      draftRevision = page.draft.revision;
      dirty = true;
      unsaved = false;
      refresh();
      status(
        baseRevision === page.revision
          ? "Đã mở bản nháp."
          : "Bản nháp dựa trên phiên bản cũ. Hãy so sánh với bản đang chạy trước khi xuất bản.",
        baseRevision !== page.revision,
      );
    });
  });
  click("overview", () => scene.focus(500, 500, 1050));
  click("camera", () => scene.toggleCamera());
  click("zoom-in", () => scene.zoom(0.75));
  click("zoom-out", () => scene.zoom(1.3));
  click("cancel", () => {
    selected = undefined;
    scene.cancelPlacement();
    scene.select(undefined);
    renderProperties();
  });
  click("logout", async () => {
    if (
      !unsaved ||
      (await ask("Bản nháp chưa được lưu. Bạn vẫn muốn đăng xuất?"))
    )
      void action(returnToEventPortal);
  });
  el<HTMLFormElement>(".studio-notify").onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget as HTMLFormElement);
    void action(async () => {
      await request("/api/admin", {
        action: "notify",
        title: data.get("title"),
        body: data.get("body"),
      });
      status("Đã gửi thông báo campaign.");
    });
  };
  mountGiftPoolEditor(el(".studio-gift-pool"), request);
  function renderGifts(gifts: Record<string, unknown>[]): void {
    const list = el(".studio-gift-results");
    list.replaceChildren();
    if (!gifts.length) list.textContent = "Chưa có quà tặng.";
    for (const gift of gifts) {
      const row = document.createElement("div"),
        code = document.createElement("strong"),
        note = document.createElement("p");
      code.textContent = String(gift.giftCode ?? gift.id);
      note.textContent = `${gift.giftName ?? "Quà hiện vật"} · ${gift.schoolName ?? ""} · ${gift.tier ?? ""} · ${gift.redeemedAt ? "Đã phát" : "Chưa phát"}`;
      row.append(code, note);
      if (!gift.redeemedAt) {
        const b = document.createElement("button");
        b.textContent = "Xác nhận đã phát quà";
        b.onclick = async () => {
          if (!(await ask(`Xác nhận đã phát quà ${code.textContent}?`))) return;
          void action(async () => {
            const result = await request<{
              gift?: Record<string, unknown>;
              error?: string;
            }>("/api/admin/gifts/redeem", { giftCode: gift.giftCode });
            if (result.error) throw new Error(result.error);
            if (result.gift) renderGifts([result.gift]);
            status("Đã xác nhận phát quà.");
          });
        };
        row.append(b);
      }
      list.append(row);
    }
  }
  click(
    "gifts",
    () =>
      void action(async () => {
        const page = await request<{ gifts: Record<string, unknown>[] }>(
          "/api/admin/gifts",
        );
        renderGifts(page.gifts);
      }),
  );
  el<HTMLFormElement>(".studio-gifts").onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget as HTMLFormElement);
    void action(async () => {
      const page = await request<{ gift: Record<string, unknown> }>(
        `/api/admin/gifts?code=${encodeURIComponent(String(data.get("code")))}`,
      );
      renderGifts([page.gift]);
    });
  };
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      scene.cancelPlacement();
      status("Đã hủy đặt vật thể.");
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      el<HTMLButtonElement>('[data-action="save"]').click();
    }
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) undoRedo(redo, undo);
      else undoRedo(undo, redo);
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (unsaved) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  await action(async () => {
    await load();
    status(
      snapshot?.draft
        ? "Có bản nháp đã lưu. Chọn Mở bản nháp để tiếp tục."
        : "Chọn vật thể hoặc kéo từ thư viện để bắt đầu.",
    );
  });
  finishBoot();
  let polling = false;
  window.setInterval(() => {
    if (busy || polling || document.hidden || app.querySelector("dialog[open]"))
      return;
    polling = true;
    void request<EditorSnapshot>("/api/admin/editor")
      .then((page) => {
        if (page.revision === (snapshot?.revision ?? baseRevision)) return;
        snapshot = page;
        history();
        if (dirty) {
          status(
            "Admin khác vừa xuất bản bản đồ mới. Bản nháp của bạn được giữ; tải bản đang chạy để đối chiếu.",
            true,
          );
          return;
        }
        objects = clone(page.objects);
        baseRevision = page.revision;
        draftRevision = page.draft?.revision ?? 0;
        undo.length = redo.length = 0;
        refresh();
        status(`Đã đồng bộ phiên bản v${baseRevision}.`);
      })
      .catch((error) =>
        status(
          error instanceof Error
            ? error.message
            : "Mất kết nối. Bản nháp trên màn hình vẫn được giữ.",
          true,
        ),
      )
      .finally(() => {
        polling = false;
      });
  }, EDITOR_CONFIG.pollMs);
}
