export type CertificateDocument = {
  certificateId: string;
  traineeName: string;
  programTitle: string;
  trainerName: string;
  completionDate: string;
  issuedAt: string;
  finalScore: number;
  status: "VALID" | "REVOKED";
};

export type CertificateRenderResult =
  | { kind: "none" }
  | { kind: "pdf"; bytes: Buffer; fileName: string };

export type CertificateRenderer = {
  render(document: CertificateDocument): Promise<CertificateRenderResult>;
};

export const noopCertificateRenderer: CertificateRenderer = {
  async render() {
    return { kind: "none" };
  },
};

export let certificateRenderer: CertificateRenderer = noopCertificateRenderer;

export function setCertificateRenderer(renderer: CertificateRenderer) {
  certificateRenderer = renderer;
}
