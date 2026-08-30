import { enrollmentRepository } from "../repositories/enrollment.repository";
import { programRepository } from "../repositories/program.repository";
import { userRepository } from "../repositories/user.repository";
import { serializePublicUsers } from "../utils/avatar-url";

export const adminService = {
  async listUsers() {
    return serializePublicUsers(await userRepository.listPublic());
  },
};

export const trainerService = {
  listPrograms(userId: string) {
    return programRepository.findByTrainerUserId(userId);
  },
};

export const traineeService = {
  listEnrollments(userId: string) {
    return enrollmentRepository.findByUser(userId);
  },
};
