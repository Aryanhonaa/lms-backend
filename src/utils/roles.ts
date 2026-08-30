import { Role } from "../generated/prisma";

export function isProgramReviewer(role: Role): boolean {
  return role === Role.SUPER_ADMIN || role === Role.ADMIN;
}

export function isPlatformGovernor(role: Role): boolean {
  return role === Role.SUPER_ADMIN;
}

export function creatableRolesFor(actor: Role): Role[] {
  if (actor === Role.SUPER_ADMIN) {
    return [Role.ADMIN, Role.TRAINER, Role.TRAINEE];
  }
  if (actor === Role.ADMIN) {
    return [Role.TRAINER, Role.TRAINEE];
  }
  return [];
}

export function canCreateRole(actor: Role, target: Role): boolean {
  return creatableRolesFor(actor).includes(target);
}

export function deletableRolesFor(actor: Role): Role[] {
  if (actor === Role.SUPER_ADMIN) {
    return [Role.SUPER_ADMIN, Role.ADMIN, Role.TRAINER, Role.TRAINEE];
  }
  if (actor === Role.ADMIN) {
    return [Role.TRAINER, Role.TRAINEE];
  }
  return [];
}

export function canDeleteRole(actor: Role, target: Role): boolean {
  return deletableRolesFor(actor).includes(target);
}

export function editableRolesFor(actor: Role): Role[] {
  return deletableRolesFor(actor);
}

export function canEditRole(actor: Role, target: Role): boolean {
  return editableRolesFor(actor).includes(target);
}
