/**
 * BrandSettingsCard — admin-only white-label settings form.
 *
 * Lives on Settings > Branding (admin-only; managers/reps don't see the tab).
 * Lets the admin set:
 *   - product_name   : the app name (browser tab + top bar)
 *   - primary_color  : the brand hue (buttons, links, highlights)
 *   - logo_url       : the logo, via UPLOAD to the public org-logos bucket
 *                      (a "paste a link" escape hatch stays tucked away)
 *   - dark_logo_url  : an OPTIONAL purpose-made dark-mode logo
 *
 * "Powered by navigatr" is intentionally NOT configurable here. The credit
 * always shows (AppLayout footer). The old toggle was removed.
 *
 * Logo uploads write straight to storage (admin-scoped by the bucket policy)
 * and stash the resulting public URL in the form; Save persists it via the
 * update_org_branding RPC. Live preview: BrandProvider re-applies the theme
 * across the app the moment Save succeeds.
 */
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button, Card, FormField, Input } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { useBrand, DEFAULT_BRAND } from "../useBrand";
import { useUpdateBrand } from "../useUpdateBrand";
import { uploadOrgLogo, validateLogoFile, type LogoVariant } from "../lib/orgLogoStorage";

const urlField = z
  .string()
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Logo URL must start with http(s)://")
  .transform((v) => (v === "" ? null : v));

const schema = z.object({
  productName: z.string().min(1, "Required").max(40, "Keep it short (max 40 chars)"),
  primaryColor: z
    .string()
    .regex(/^(|#[0-9a-fA-F]{6})$/, "Use a #rrggbb hex like #2456E6")
    .transform((v) => (v === "" ? null : v.toLowerCase())),
  logoUrl: urlField,
  darkLogoUrl: urlField,
});

type Values = z.input<typeof schema>;

/** Empty/blank -> null, otherwise the trimmed value. Robust to react-hook-form
 *  handing us either raw strings or the resolver's already-transformed values. */
const blankToNull = (v: string | null | undefined): string | null =>
  v && v.trim() !== "" ? v : null;

export function BrandSettingsCard() {
  const brand = useBrand();
  const update = useUpdateBrand();
  const orgId = useProfile().data?.org_id;
  const [uploading, setUploading] = React.useState<LogoVariant | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { productName: DEFAULT_BRAND.productName, primaryColor: "", logoUrl: "", darkLogoUrl: "" },
  });

  // Hydrate once the brand query resolves (react-hook-form only reads
  // defaultValues on mount, so reset() refills after the async fetch).
  React.useEffect(() => {
    if (brand.data) {
      reset({
        productName: brand.data.productName,
        primaryColor: brand.data.primaryColor ?? "",
        logoUrl: brand.data.logoUrl ?? "",
        darkLogoUrl: brand.data.darkLogoUrl ?? "",
      });
    }
  }, [brand.data, reset]);

  const logoUrl = watch("logoUrl");
  const darkLogoUrl = watch("darkLogoUrl");

  async function handleFile(file: File, variant: LogoVariant) {
    const invalid = validateLogoFile(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    if (!orgId) {
      toast.error("Couldn't find your organization. Please refresh and try again.");
      return;
    }
    setUploading(variant);
    try {
      const url = await uploadOrgLogo(file, orgId, variant);
      setValue(variant === "logo" ? "logoUrl" : "darkLogoUrl", url, {
        shouldDirty: true,
        shouldValidate: true,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload that logo");
    } finally {
      setUploading(null);
    }
  }

  const onSubmit = async (values: Values) => {
    // Validation already ran via the resolver; here we just normalize blanks to
    // null so "Remove"/empty clears the field (the RPC treats null/'' as clear).
    try {
      await update.mutateAsync({
        productName: values.productName,
        primaryColor: blankToNull(values.primaryColor)?.toLowerCase() ?? null,
        logoUrl: blankToNull(values.logoUrl),
        darkLogoUrl: blankToNull(values.darkLogoUrl),
      });
      toast.success("Branding updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save branding");
    }
  };

  const resetToDefaults = async () => {
    try {
      await update.mutateAsync({
        productName: DEFAULT_BRAND.productName,
        primaryColor: null,
        logoUrl: null,
        darkLogoUrl: null,
      });
      toast.success("Reset to default branding");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reset");
    }
  };

  const busy = update.isPending || uploading !== null;
  // Data-loss guard: the RPC sets each field directly (blank clears it), so the
  // form MUST submit the org's real current state. Don't render the editable
  // form (hence Save) until the current branding has actually loaded; if it
  // errors, show a message instead of a blank form that would wipe on save.
  const loaded = Boolean(brand.data);

  return (
    <Card padding="md">
      <h2 className="text-body-strong">White-label branding</h2>
      <p className="mt-1 text-body-md text-text-muted">
        Customize how the app looks for your team. Changes apply instantly after Save.
      </p>

      {brand.isError ? (
        <p className="mt-4 rounded-radius-sm border border-status-danger bg-status-danger-bg px-3 py-2 text-body-sm text-status-danger">
          We couldn't load your current branding. Refresh and try again. We won't save until it
          loads, so nothing gets overwritten.
        </p>
      ) : !loaded ? (
        <p className="mt-4 text-body-sm text-text-muted">Loading your branding...</p>
      ) : (
      <form onSubmit={handleSubmit(onSubmit)} className="mt-4 flex flex-col gap-4" noValidate>
        {/* Logo (upload) */}
        <FormField label="Logo" htmlFor="brand-logo" helper="Shown in the top bar. PNG, JPG, SVG or WebP, up to 2 MB.">
          <LogoUploader
            id="brand-logo"
            value={logoUrl}
            uploading={uploading === "logo"}
            onFile={(f) => handleFile(f, "logo")}
            onRemove={() => setValue("logoUrl", "", { shouldDirty: true })}
          />
        </FormField>

        <details className="rounded-radius-sm">
          <summary className="cursor-pointer text-caption text-text-muted">Prefer to paste a link?</summary>
          <div className="mt-2">
            <Input id="brand-logo-url" type="url" placeholder="https://yourcompany.com/logo.png" {...register("logoUrl")} />
            {errors.logoUrl && <p className="mt-1 text-caption text-status-danger">{errors.logoUrl.message}</p>}
          </div>
        </details>

        <details className="rounded-radius-sm">
          <summary className="cursor-pointer text-caption text-text-muted">Add a dark-mode logo (optional)</summary>
          <p className="mt-2 text-caption text-text-muted">
            Shown only to reps using dark mode. Skip it and we keep your main logo readable automatically.
          </p>
          <div className="mt-2">
            <LogoUploader
              id="brand-dark-logo"
              value={darkLogoUrl}
              dark
              uploading={uploading === "dark-logo"}
              onFile={(f) => handleFile(f, "dark-logo")}
              onRemove={() => setValue("darkLogoUrl", "", { shouldDirty: true })}
            />
          </div>
        </details>

        {/* Brand color */}
        <FormField
          label="Brand color"
          htmlFor="brand-primary-color"
          error={errors.primaryColor?.message}
          helper="Hex like #2456E6. Leave empty for the default."
        >
          <div className="flex items-center gap-3">
            <Input
              id="brand-primary-color"
              type="text"
              placeholder="#2456E6"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              {...register("primaryColor")}
            />
            <Swatch hex={watch("primaryColor")} />
          </div>
        </FormField>

        {/* Product name */}
        <FormField
          label="Product name"
          htmlFor="brand-product-name"
          error={errors.productName?.message}
          helper="Shown in the browser tab + top bar"
        >
          <Input id="brand-product-name" type="text" placeholder="navigatr" {...register("productName")} />
        </FormField>

        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="submit" variant="primary" size="md" disabled={!isDirty || busy || !loaded} loading={update.isPending}>
            Save branding
          </Button>
          <Button type="button" variant="tertiary" size="md" onClick={resetToDefaults} disabled={busy}>
            Reset to defaults
          </Button>
        </div>
      </form>
      )}
    </Card>
  );
}

/** Click-or-drag logo uploader with a live preview + remove. `dark` renders
 *  the preview on a dark chip (so a light dark-mode logo shows). */
function LogoUploader({
  id,
  value,
  dark,
  uploading,
  onFile,
  onRemove,
}: {
  id: string;
  value: string | null | undefined;
  dark?: boolean;
  uploading: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const open = () => inputRef.current?.click();

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-radius-sm border border-border-subtle bg-surface-sunken px-3 py-2">
        <span
          className={`grid h-10 min-w-10 max-w-[150px] place-items-center overflow-hidden rounded-radius-sm border border-border-subtle px-2 ${dark ? "bg-[#12141c]" : "bg-white"}`}
        >
          <img src={value} alt="Logo preview" className="max-h-7 max-w-[130px] object-contain" />
        </span>
        <span className="text-body-sm text-text-muted">Looks good.</span>
        <span className="ml-auto flex gap-2">
          <Button type="button" variant="tertiary" size="sm" onClick={open} loading={uploading}>
            Replace
          </Button>
          <Button type="button" variant="tertiary" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </span>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`flex w-full items-center gap-3 rounded-radius-sm border border-dashed px-4 py-4 text-left transition-colors ${
        drag ? "border-brand-primary bg-brand-primary-10" : "border-border-default bg-surface-sunken hover:border-brand-primary"
      }`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-radius-sm border border-border-subtle bg-surface-elevated text-text-muted">
        {uploading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border-default border-t-brand-primary" aria-label="Uploading" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4" />
            <path d="m7 9 5-5 5 5" />
            <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
          </svg>
        )}
      </span>
      <span className="flex flex-col">
        <span className="text-body-sm font-medium text-text-default">
          {uploading ? "Uploading…" : "Drag a logo here, or click to upload"}
        </span>
        <span className="text-caption text-text-muted">PNG, JPG, SVG or WebP · up to 2 MB</span>
      </span>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}

// Swatch next to the color input so the admin sees the hue before saving.
function Swatch({ hex }: { hex: string }) {
  const isValid = /^#[0-9a-fA-F]{6}$/.test(hex);
  if (!isValid) {
    return (
      <span
        aria-label="No primary color set"
        className="h-8 w-8 rounded-radius-sm border border-dashed border-border-default"
      />
    );
  }
  return (
    <span
      aria-label={`Primary color preview ${hex}`}
      className="h-8 w-8 rounded-radius-sm border border-border-default"
      style={{ backgroundColor: hex }}
    />
  );
}
