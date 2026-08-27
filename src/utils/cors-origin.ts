const PRIVATE_V4 =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

function parseAllowList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function isAllowedCorsOrigin(origin: string | undefined, configured: string): boolean {
  if (!origin) {
    return true;
  }

  const normalized = origin.replace(/\/$/, "");
  if (parseAllowList(configured).includes(normalized)) {
    return true;
  }

  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const privateHost = PRIVATE_V4.test(url.hostname) || url.hostname.endsWith(".local");
    const frontendPort = url.port === "" || url.port === "3000" || url.port === "3001";
    return (localHost || privateHost) && frontendPort;
  } catch {
    return false;
  }
}
