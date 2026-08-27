import { adminRouter, traineeRouter, trainerRouter } from "../../routes/rbac.routes";

export const adminModule = { router: adminRouter };
export const trainerModule = { router: trainerRouter };
export const traineeModule = { router: traineeRouter };
