// Live smoke check for the stored-file endpoints against a running API.
// Usage: node scripts/smoke-files.mjs [baseUrl]
const base = process.argv[2] ?? "http://localhost:5000/api/v1";
let cookie = "";

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cookie = setCookie.split(";")[0];
  }
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text.slice(0, 200) };
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status} ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload.data;
}

function json(method, body) {
  return { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
}

const PDF = new Blob([Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n")], {
  type: "application/pdf",
});

await call("/auth/login", json("POST", { email: "trainer@lms.local", password: "DevPass123!" }));
console.log("logged in as trainer");

const created = await call(
  "/trainer/programs",
  json("POST", {
    title: `Storage smoke ${new Date().toISOString().slice(11, 19)}`,
    description: "Temporary program for the storage smoke check",
    category: "Web",
    difficulty: "BEGINNER",
    durationWeeks: 1,
    trainingMode: "PROGRESSION",
  }),
);
const programId = created.program.id;

let tree = (await call(`/trainer/programs/${programId}/weeks`, json("POST", { title: "Week 1" }))).program;
const weekId = tree.weeks[0].id;
tree = (await call(`/trainer/weeks/${weekId}/days`, json("POST", { title: "Day 1" }))).program;
const dayId = tree.weeks[0].days[0].id;

const form = new FormData();
form.append("file", PDF, "smoke-doc.pdf");
form.append("purpose", "RESOURCE");
form.append("dayId", dayId);
const uploaded = (await call("/trainer/uploads/files", { method: "POST", body: form })).file;
console.log("uploaded:", uploaded.key, uploaded.storageProvider);

const withResource = (
  await call(
    `/trainer/days/${dayId}/resources`,
    json("POST", {
      title: "Smoke handout",
      kind: "DOCUMENT",
      fileKey: uploaded.key,
      fileName: uploaded.fileName,
      mimeType: uploaded.mimeType,
      fileSize: uploaded.fileSize,
    }),
  )
).program;
const resource = withResource.weeks[0].days[0].resources.find((row) => row.fileKey === uploaded.key);
console.log("resource saved:", resource.id, resource.mimeType, resource.fileSize);

const access = await call(`/trainer/items/RESOURCE/${resource.id}/file`);
console.log("access:", access.strategy, access.fileName, access.expiresAt ?? "no expiry (stream)");

const ticket = await call(
  "/trainer/uploads/tickets",
  json("POST", { purpose: "VIDEO", dayId, fileName: "clip.mp4", mimeType: "video/mp4", fileSize: 1048576 }),
);
console.log("direct-to-storage upload available:", ticket.direct);

const badForm = new FormData();
badForm.append("file", new Blob([Buffer.from("MZ")], { type: "application/pdf" }), "payload.exe");
badForm.append("purpose", "RESOURCE");
badForm.append("dayId", dayId);
const blocked = await fetch(`${base}/trainer/uploads/files`, { method: "POST", body: badForm, headers: { Cookie: cookie } });
console.log("executable upload rejected:", blocked.status === 400);

await call(`/trainer/resources/${resource.id}`, { method: "DELETE" });
console.log("cleanup complete; remove the draft program manually if it is no longer needed:", programId);
