export const ROLE_PERMISSIONS = {
  SuperUser: ['*'],
  Admin: [
    'dashboard:read',
    'cases:read',
    'cases:write',
    'users:manage',
  ],
  DepartmentLead: [
    'dashboard:read',
    'cases:read',
    'cases:write:department',
    'users:manage:department',
  ],
  Employee: [
    'dashboard:read',
    'cases:read:department',
  ],
  Sales: [
    'dashboard:read',
    'cases:read:department',
  ],
  BondClient: ['cases:read:self'],
};

export function roleHasPermission(rolePermissions = [], permission) {
  if (!Array.isArray(rolePermissions)) return false;
  if (rolePermissions.includes('*')) return true;
  return rolePermissions.includes(permission);
}

export function userHasPermission(userRoles = [], permission) {
  if (!Array.isArray(userRoles) || userRoles.length === 0) return false;
  return userRoles.some((role) => {
    const perms = ROLE_PERMISSIONS[role] || [];
    return perms.includes('*') || perms.includes(permission);
  });
}
