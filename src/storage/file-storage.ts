export type StoredFile = {
  key: string;
  url: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  provider: string;
};

export type FileStoreInput = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
  folder: string;
  visibility?: "public" | "private";
  key?: string;
};

export type SignedUpload = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

export type FileStorage = {
  readonly provider: string;
  save(input: FileStoreInput, publicOrigin: string): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  signedDownloadUrl(key: string, options?: { expiresInSeconds?: number; fileName?: string; mimeType?: string }): Promise<string | null>;
  signedUploadUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<SignedUpload | null>;
};
