export const ADMIN_PERMISSIONS = {
  "rankings.view": "Xem bảng xếp hạng",
  "map.view": "Xem bản đồ trong Live Editor",
  "map.edit": "Chỉnh sửa và lưu bản nháp",
  "map.publish": "Xuất bản / khôi phục bản đồ",
  "notifications.send": "Gửi thông báo",
  "gifts.view": "Tra cứu quà và mã nhận quà",
  "gifts.manage": "Thêm / sửa kho quà thật",
  "gifts.redeem": "Xác nhận đã trao quà",
  "audit.view": "Xem lịch sử quản trị",
  "admins.manage": "Tạo tài khoản và phân quyền",
} as const;
export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;
export const ALL_ADMIN_PERMISSIONS = Object.keys(
  ADMIN_PERMISSIONS,
) as AdminPermission[];
export const ADMIN_ROLES = {
  full: { label: "Quản trị đầy đủ", permissions: ALL_ADMIN_PERMISSIONS },
  viewer: { label: "Quan sát viên", permissions: ["rankings.view"] },
  partner: {
    label: "Đối tác thử nghiệm · Chỉ xem",
    permissions: ["rankings.view", "map.view", "gifts.view", "audit.view"],
  },
  testPlayer: { label: "Chỉ chơi 8 hồ sơ test", permissions: [] },
  editor: {
    label: "Biên tập bản đồ",
    permissions: ["rankings.view", "map.view", "map.edit"],
  },
  rewards: {
    label: "Phụ trách quà",
    permissions: [
      "rankings.view",
      "gifts.view",
      "gifts.manage",
      "gifts.redeem",
    ],
  },
  communications: {
    label: "Truyền thông",
    permissions: ["rankings.view", "notifications.send"],
  },
  custom: { label: "Tùy chỉnh", permissions: [] },
} as const satisfies Record<
  string,
  { label: string; permissions: readonly AdminPermission[] }
>;
export type AdminRole = keyof typeof ADMIN_ROLES;
export const ROOT_ADMIN_EMAIL = "admin@amtech.vn";
export const isStaffSsoEmail = (email: string): boolean =>
  ["amtech.vn", "amtech-vn.com"].includes(email.split("@")[1] ?? "");
export function defaultAdminPermissions(
  email: string,
): readonly AdminPermission[] {
  return ["acer.com", "dava.vn"].includes(email.split("@")[1] ?? "")
    ? ADMIN_ROLES.viewer.permissions
    : ALL_ADMIN_PERMISSIONS;
}
export interface AdminAccess {
  readonly email?: string;
  readonly permissions?: readonly AdminPermission[];
  readonly protectedRoot?: boolean;
}
/** Missing capabilities never grant permission, including stale browser sessions. */
export const canAdmin = (
  admin: AdminAccess,
  permission: AdminPermission,
): boolean => admin.permissions?.includes(permission) === true;
export interface AdminAccountView {
  actorId: string;
  email: string;
  name: string;
  enabled: boolean;
  permissions: readonly AdminPermission[];
  protectedRoot: boolean;
  login: "password" | "portal";
  revision: number;
  testProfiles?: boolean;
}
