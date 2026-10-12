/**
 * QR images for the public referral form links (FR-PORT-24). The qrcode
 * library is imported on demand, so it is a separate chunk fetched only when
 * a rep opens the Share sheet.
 */
export async function referralQrDataUrl(url: string): Promise<string> {
  const mod = await import("qrcode");
  // qrcode is CommonJS: depending on the bundler's interop the functions sit on
  // the namespace or on its default export.
  type QrLib = Pick<typeof import("qrcode"), "toDataURL">;
  let lib: QrLib = mod;
  try {
    const viaDefault = (mod as unknown as { default?: QrLib }).default;
    if (viaDefault) lib = viaDefault;
  } catch {
    // A strict module namespace (such as a test double) throws on a missing default: use the namespace.
  }
  return lib.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: "M" });
}

export function referralQrFileName(linkType: "user" | "tenant"): string {
  return linkType === "tenant" ? "company-referral-qr.png" : "my-referral-qr.png";
}
