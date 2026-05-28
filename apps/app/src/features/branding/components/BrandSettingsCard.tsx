/**
 * BrandSettingsCard — admin-only white-label settings form.
 *
 * Lives on /admin/settings. Lets the admin set:
 *   - product_name        : what the tab title + login surfaces call the app
 *   - primary_color       : the brand button + active-state hue
 *   - logo_url            : URL of a hosted logo (no upload at v1; URL only)
 *   - show_powered_by     : "Powered by navigatr" footer toggle
 *
 * No file upload at v1 — keeps Supabase Storage configuration out of the
 * critical path. ISOs that want a custom logo paste a URL from their own
 * CDN or a public Supabase Storage bucket. We can layer upload on top later
 * without changing this form's shape.
 *
 * Live preview: the BrandProvider mounted higher in the tree updates the
 * CSS variables on document.documentElement after every successful save.
 * The Primary button below sits on the same vars, so the admin sees the
 * theme flip the moment "Save" succeeds — no reload, no flash.
 */
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button, Card, FormField, Input } from "@/components/navigatr";
import { useBrand, DEFAULT_BRAND } from "../useBrand";
import { useUpdateBrand } from "../useUpdateBrand";

// Zod schema mirrors the RPC's server-side validation. We do the same
// checks client-side for fast feedback; the server is still the
// authoritative gate.
const schema = z.object({
  productName: z
    .string()
    .min(1, "Required")
    .max(40, "Keep it short (max 40 chars)"),
  // Allow empty string OR a #rrggbb. Empty = "use default".
  primaryColor: z
    .string()
    .regex(/^(|#[0-9a-fA-F]{6})$/, "Use a #rrggbb hex like #2456E6")
    .transform((v) => (v === "" ? null : v.toLowerCase())),
  logoUrl: z
    .string()
    .refine(
      (v) => v === "" || /^https?:\/\//i.test(v),
      "Logo URL must start with http(s)://",
    )
    .transform((v) => (v === "" ? null : v)),
  showPoweredBy: z.boolean(),
});

type Values = z.input<typeof schema>;
type ParsedValues = z.output<typeof schema>;

export function BrandSettingsCard() {
  const brand = useBrand();
  const update = useUpdateBrand();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      productName: DEFAULT_BRAND.productName,
      primaryColor: "",
      logoUrl: "",
      showPoweredBy: DEFAULT_BRAND.showPoweredBy,
    },
  });

  // Hydrate the form once the brand query loads. We avoid passing the
  // live brand data into defaultValues directly because react-hook-form
  // only consumes those on mount — using reset() lets us refill the form
  // after the async fetch resolves.
  React.useEffect(() => {
    if (brand.data) {
      reset({
        productName: brand.data.productName,
        primaryColor: brand.data.primaryColor ?? "",
        logoUrl: brand.data.logoUrl ?? "",
        showPoweredBy: brand.data.showPoweredBy,
      });
    }
  }, [brand.data, reset]);

  const onSubmit = async (raw: Values) => {
    // zod's `transform` makes the resolved type a ParsedValues. We re-parse
    // here to get the cleaned shape with `null` for empty strings.
    const parsed = schema.parse(raw) as ParsedValues;
    try {
      await update.mutateAsync({
        productName:   parsed.productName,
        primaryColor:  parsed.primaryColor,
        logoUrl:       parsed.logoUrl,
        showPoweredBy: parsed.showPoweredBy,
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
        showPoweredBy: DEFAULT_BRAND.showPoweredBy,
      });
      toast.success("Reset to default branding");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reset");
    }
  };

  const logoUrl = watch("logoUrl");

  return (
    <Card padding="md">
      <h2 className="text-body-strong">White-label branding</h2>
      <p className="mt-1 text-body-md text-text-muted">
        Customize how the app looks for your team. Changes apply instantly
        after Save.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-4 flex flex-col gap-4"
        noValidate
      >
        <FormField
          label="Product name"
          htmlFor="brand-product-name"
          error={errors.productName?.message}
          helper="Shown in the browser tab + email footer"
        >
          <Input
            id="brand-product-name"
            type="text"
            placeholder="navigatr"
            {...register("productName")}
          />
        </FormField>

        <FormField
          label="Primary color"
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

        <FormField
          label="Logo URL"
          htmlFor="brand-logo-url"
          error={errors.logoUrl?.message}
          helper="Public https URL — paste from your CDN or storage bucket"
        >
          <Input
            id="brand-logo-url"
            type="url"
            placeholder="https://cdn.example.com/logo.png"
            {...register("logoUrl")}
          />
        </FormField>

        {logoUrl && (
          // Preview just below the input. Width-capped so a giant artwork
          // doesn't blow out the form. onError dims the preview if the
          // image fails to load — we don't surface a hard error since the
          // user might still be typing the URL.
          <div className="flex items-center gap-3 rounded-radius-sm border border-border-subtle bg-surface-sunken px-3 py-2">
            <span className="text-caption text-text-muted">Preview:</span>
            <img
              src={logoUrl}
              alt="Logo preview"
              className="h-8 max-w-[160px] object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
              }}
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-body-md text-text-default">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border-default"
            {...register("showPoweredBy")}
          />
          Show &ldquo;Powered by navigatr&rdquo; in the footer
        </label>

        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!isDirty || update.isPending}
            loading={update.isPending}
          >
            Save branding
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="md"
            onClick={resetToDefaults}
            disabled={update.isPending}
          >
            Reset to defaults
          </Button>
        </div>
      </form>
    </Card>
  );
}

// Small swatch next to the color input so the admin sees what they typed
// before saving. Falls back to a dashed-border empty box if the hex is
// blank or malformed.
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
