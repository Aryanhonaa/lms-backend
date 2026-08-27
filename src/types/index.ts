import type { Role } from "../generated/prisma";

export type {
  ApiErrorBody,
  ApiErrorResponse,
  ApiSuccessResponse,
  HealthStatus,
} from "./api";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
  createdAt: Date;
};
