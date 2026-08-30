import { Prisma, Role } from "../generated/prisma";
import { userRepository } from "../repositories/user.repository";
import type { AuthUser } from "../types";
import { ApiError } from "../utils/api-error";
import { hashPassword } from "../utils/password";
import { canCreateRole, canDeleteRole, canEditRole } from "../utils/roles";
import { isUuid } from "../validators/common";
import type { CreateUserInput, UpdateUserInput } from "../validators/user.validators";

export const userService = {
  async createAccount(actor: AuthUser, input: CreateUserInput) {
    if (!canCreateRole(actor.role, input.role)) {
      throw ApiError.forbidden("You don't have permission to create this account.");
    }

    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw ApiError.conflict("An account with this email already exists.");
    }

    const passwordHash = await hashPassword(input.password);

    try {
      return await userRepository.create({
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw ApiError.conflict("An account with this email already exists.");
      }
      throw error;
    }
  },

  async deleteAccount(actor: AuthUser, userId: string) {
    if (!isUuid(userId)) {
      throw ApiError.notFound("User not found.");
    }
    if (actor.id === userId) {
      throw ApiError.forbidden("You cannot delete your own account.");
    }

    const target = await userRepository.findById(userId);
    if (!target) {
      throw ApiError.notFound("User not found.");
    }
    if (!canDeleteRole(actor.role, target.role)) {
      throw ApiError.forbidden("You don't have permission to delete this account.");
    }
    if (target.role === Role.SUPER_ADMIN) {
      const remaining = await userRepository.countByRole(Role.SUPER_ADMIN);
      if (remaining <= 1) {
        throw ApiError.conflict("Cannot delete the last Super Admin account.");
      }
    }

    const blockers = await userRepository.deletionBlockers(userId);
    if (blockers.createdPrograms > 0) {
      throw ApiError.conflict("This user created programs and cannot be deleted.");
    }
    if (blockers.announcements > 0) {
      throw ApiError.conflict("This user posted announcements and cannot be deleted.");
    }
    if (blockers.issuedCertificates > 0) {
      throw ApiError.conflict("This user issued certificates and cannot be deleted.");
    }
    if (blockers.markedAttendances > 0) {
      throw ApiError.conflict("This user marked attendance records and cannot be deleted.");
    }
    if (blockers.assignedRequirements > 0) {
      throw ApiError.conflict("This user assigned individual requirements and cannot be deleted.");
    }

    try {
      await userRepository.deleteOwnedRecords(userId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw ApiError.notFound("User not found.");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw ApiError.conflict("This user has records that must be preserved and cannot be deleted.");
      }
      throw error;
    }

    return { deleted: true };
  },

  async updateAccount(actor: AuthUser, userId: string, input: UpdateUserInput) {
    if (!isUuid(userId)) {
      throw ApiError.notFound("User not found.");
    }

    const target = await userRepository.findById(userId);
    if (!target) {
      throw ApiError.notFound("User not found.");
    }
    if (!canEditRole(actor.role, target.role)) {
      throw ApiError.forbidden("You don't have permission to edit this account.");
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    if (normalizedEmail !== target.email.toLowerCase()) {
      const existing = await userRepository.findByEmail(normalizedEmail);
      if (existing && existing.id !== userId) {
        throw ApiError.conflict("An account with this email already exists.");
      }
    }

    const password = input.password?.trim();
    const passwordHash = password ? await hashPassword(password) : undefined;

    try {
      return await userRepository.updateAccount(userId, {
        name: input.name.trim(),
        email: normalizedEmail,
        passwordHash,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw ApiError.conflict("An account with this email already exists.");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw ApiError.notFound("User not found.");
      }
      throw error;
    }
  },
};
