import type { HealthStatus } from "../types/api";

export const healthService = {
  getStatus(): HealthStatus {
    return { status: "ok" };
  },
};
