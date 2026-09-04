import { describe, it, expect, vi, beforeEach } from "vitest";

const upload = vi.fn();
const getPublicUrl = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: () => ({ upload, getPublicUrl }) } },
}));

import { validateLogoFile, uploadOrgLogo, MAX_LOGO_BYTES } from "./orgLogoStorage";

function fileOf(type: string, name = "logo.png", size = 500): File {
  const f = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ error: null });
  getPublicUrl.mockReset().mockReturnValue({
    data: { publicUrl: "https://ref.supabase.co/storage/v1/object/public/org-logos/o-1/logo-1.png" },
  });
});

describe("validateLogoFile", () => {
  it("accepts png / jpg / svg / webp under the size cap", () => {
    expect(validateLogoFile(fileOf("image/png"))).toBeNull();
    expect(validateLogoFile(fileOf("image/jpeg"))).toBeNull();
    expect(validateLogoFile(fileOf("image/svg+xml"))).toBeNull();
    expect(validateLogoFile(fileOf("image/webp"))).toBeNull();
  });
  it("rejects an unsupported type", () => {
    expect(validateLogoFile(fileOf("image/gif"))).toMatch(/PNG, JPG, SVG, or WebP/i);
  });
  it("rejects a file over 2 MB", () => {
    expect(validateLogoFile(fileOf("image/png", "big.png", MAX_LOGO_BYTES + 1))).toMatch(/over 2 MB/i);
  });
});

describe("uploadOrgLogo", () => {
  it("uploads to an org-scoped 'logo-' path and returns the public URL", async () => {
    const url = await uploadOrgLogo(fileOf("image/png"), "o-1", "logo");
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, , opts] = upload.mock.calls[0];
    expect(path).toMatch(/^o-1\/logo-\d+\.png$/);
    expect(opts).toMatchObject({ contentType: "image/png", upsert: true });
    expect(url).toContain("/org-logos/");
  });

  it("uses a 'dark-logo-' path for the dark variant", async () => {
    await uploadOrgLogo(fileOf("image/svg+xml", "d.svg"), "o-9", "dark-logo");
    expect(upload.mock.calls[0][0]).toMatch(/^o-9\/dark-logo-\d+\.svg$/);
  });

  it("throws (and never uploads) when the file is invalid", async () => {
    await expect(uploadOrgLogo(fileOf("image/gif"), "o-1", "logo")).rejects.toThrow(/PNG, JPG, SVG, or WebP/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it("throws when the storage upload errors", async () => {
    upload.mockResolvedValue({ error: { message: "bucket boom" } });
    await expect(uploadOrgLogo(fileOf("image/png"), "o-1", "logo")).rejects.toThrow("bucket boom");
  });
});
