import { loadBackendEnv } from "../src/config/load-env";

process.env.NODE_ENV = "test";
loadBackendEnv();
