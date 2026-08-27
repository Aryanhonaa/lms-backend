export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

export type ApiErrorBody = {
  message: string;
  code: string;
};

export type ApiErrorResponse = {
  success: false;
  error: ApiErrorBody;
};

export type HealthStatus = {
  status: "ok";
};
