/** The fixed roles (PDP-251, ADM-03), mirrored from backend/shared/auth/roles.py. */

export const ROLE_SUPER_ADMIN = "super_admin";
export const ROLE_ADMIN = "admin";
export const ROLE_MODEL_AUTHOR = "model_author";
export const ROLE_STRUCTURE_EDITOR = "structure_editor";
export const ROLE_ANALYST = "analyst";

export type RoleCode =
  | typeof ROLE_SUPER_ADMIN
  | typeof ROLE_ADMIN
  | typeof ROLE_MODEL_AUTHOR
  | typeof ROLE_STRUCTURE_EDITOR
  | typeof ROLE_ANALYST;

export const ALL_ROLES: RoleCode[] = [ROLE_SUPER_ADMIN, ROLE_ADMIN, ROLE_MODEL_AUTHOR, ROLE_STRUCTURE_EDITOR, ROLE_ANALYST];

export const ROLE_LABELS: Record<string, string> = {
  [ROLE_SUPER_ADMIN]: "Super Admin",
  [ROLE_ADMIN]: "Admin",
  [ROLE_MODEL_AUTHOR]: "Model Author",
  [ROLE_STRUCTURE_EDITOR]: "Structure Editor",
  [ROLE_ANALYST]: "Analyst"
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  [ROLE_SUPER_ADMIN]: "Every permission: administration plus all of the working roles.",
  [ROLE_ADMIN]: "Manage users, roles and application administration.",
  [ROLE_MODEL_AUTHOR]: "Create and maintain model definitions in the Model Workspace.",
  [ROLE_STRUCTURE_EDITOR]: "Create and maintain instances and relationships in the Structure Workspace.",
  [ROLE_ANALYST]: "Perform data profiling, mapping and quality assessment in the Discover Workspace."
};

/** Whether the roles someone holds satisfy a check for `role`. Super Admin satisfies all. */
export function grants(held: string[], role: string): boolean {
  return held.includes(ROLE_SUPER_ADMIN) || held.includes(role);
}

export function isAdministrator(held: string[]): boolean {
  return held.includes(ROLE_SUPER_ADMIN) || held.includes(ROLE_ADMIN);
}

export function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code;
}
