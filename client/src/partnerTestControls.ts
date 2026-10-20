import { SCHOOLS } from "../../shared/gameplay/gameConfig.ts";
import { gameFetch } from "./gameHttp.ts";
import "./partnerTestControls.css";

export function mountPartnerTestControls(slot: number): void {
  const panel = document.createElement("nav");
  panel.className = "partner-test-controls";
  panel.setAttribute("aria-label", "Tài khoản đối tác thử nghiệm");
  const label = document.createElement("label"),
    select = document.createElement("select"),
    admin = document.createElement("a"),
    status = document.createElement("span");
  label.textContent = "Hồ sơ test ";
  select.setAttribute("aria-label", "Chọn hồ sơ test theo trường");
  for (const school of SCHOOLS) {
    const option = document.createElement("option");
    option.value = school.id;
    option.textContent = school.shortName;
    option.selected = school.slot === slot;
    select.append(option);
  }
  label.append(select);
  admin.href = "/admin";
  admin.textContent = "Xem dashboard ↗";
  status.setAttribute("role", "status");
  panel.append(label, admin, status);
  document.body.append(panel);
  select.onchange = async () => {
    select.disabled = true;
    status.textContent = "Đang đổi hồ sơ…";
    try {
      const response = await gameFetch("/api/test-profiles/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: select.value }),
      });
      if (!response.ok)
        throw new Error(
          "Chưa đổi được hồ sơ. Tải lại trang để cập nhật phiên.",
        );
      location.assign("/");
    } catch (error) {
      status.textContent = (error as Error).message;
      select.value = SCHOOLS.find((s) => s.slot === slot)!.id;
      select.disabled = false;
    }
  };
}
