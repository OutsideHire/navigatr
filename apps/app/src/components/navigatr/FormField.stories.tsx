/**
 * Visual catalog for FormField, Input, Textarea, Select, Checkbox, Toggle.
 *
 * Mounted at /component-preview/form-fields. Compare side-by-side with
 * Figma nodes 123:98 (FormField), 21:43 (Input), 22:18 (Select).
 *
 * Sections:
 *   - Input: all states (empty / filled / focused / error / disabled)
 *   - Input: with helper, with leading/trailing icons, prefix/suffix, onClear
 *   - Input: all sizes, all common input types
 *   - Textarea: rows, char count, mic affordance
 *   - Select: rest / focused / error / disabled, sizes
 *   - Checkbox: unchecked / checked / disabled, with label + helper
 *   - Toggle:   off / on / disabled, with label + helper
 */

import { useState } from "react";
import {
  Search,
  Mail,
  Phone,
  Lock,
  CalendarIcon,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import {
  Button,
  Checkbox,
  FormField,
  Input,
  Select,
  Textarea,
  type SelectOption,
} from "@/components/navigatr";
import { useTheme, type Theme } from "@/stores/theme";

const SIZES = ["sm", "md", "lg"] as const;

const SAMPLE_OPTIONS: SelectOption[] = [
  { value: "payroll", label: "Payroll" },
  { value: "merchant", label: "Merchant Services" },
  { value: "treasury", label: "Treasury Management" },
  { value: "disabled-row", label: "Disabled row", disabled: true },
];

const NEXT_THEME: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
const THEME_LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-eyebrow text-text-subtle">{label}</span>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-radius-lg border border-border-subtle bg-surface-elevated p-6">
      <div>
        <h2 className="text-heading-md text-text-default">{title}</h2>
        {subtitle && <p className="mt-1 text-body-md text-text-muted">{subtitle}</p>}
      </div>
      <div className="grid gap-5 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function FormFieldStories() {
  const theme = useTheme((s) => s.theme);
  const resolvedTheme = useTheme((s) => s.resolvedTheme);
  const setTheme = useTheme((s) => s.setTheme);
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  // Local state for clearable / textarea / select / checkbox / toggle demos
  const [clearable, setClearable] = useState("hello world");
  const [textareaValue, setTextareaValue] = useState(
    "Quick notes about the deal. The lg gap above is 10 px from Figma's space drift.",
  );
  const [selectValue, setSelectValue] = useState<string>();
  const [checkbox, setCheckbox] = useState(false);
  const [toggle, setToggle] = useState(true);

  return (
    <main className="min-h-dvh bg-surface-canvas px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-eyebrow text-text-subtle">Component preview · Form fields</p>
            <h1 className="mt-1 text-heading-xl text-text-default">FormField / Input / Textarea / Select / Checkbox / Toggle</h1>
            <p className="mt-2 max-w-2xl text-body-md text-text-muted">
              Sourced from Figma <code className="text-code text-text-default">123:98</code> (FormField),{" "}
              <code className="text-code text-text-default">21:43</code> (Input set), and{" "}
              <code className="text-code text-text-default">22:18</code> (Select set). Checkbox + Toggle have no Figma source yet —
              flagged for reverse-import.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={ThemeIcon}
            onClick={() => setTheme(NEXT_THEME[theme])}
          >
            Theme: {THEME_LABEL[theme]}
            <span className="text-text-subtle">({resolvedTheme})</span>
          </Button>
        </header>

        {/* INPUT STATES */}
        <Section title="Input · states (md)">
          <FormField label="Empty" htmlFor="demo-empty" helper="Helper text">
            <Input placeholder="you@company.com" />
          </FormField>
          <FormField label="Filled" htmlFor="demo-filled" helper="Helper text">
            <Input defaultValue="jamie@navigatr.app" />
          </FormField>
          <FormField label="Error" htmlFor="demo-error" error="Enter a valid email address">
            <Input defaultValue="not-an-email" />
          </FormField>
          <FormField label="Disabled" htmlFor="demo-disabled" helper="Read only" disabled>
            <Input defaultValue="locked@navigatr.app" disabled />
          </FormField>
        </Section>

        {/* SIZES */}
        <Section title="Input · sizes" subtitle="md is Figma canonical; sm/lg extrapolated to match Button rhythm.">
          {SIZES.map((size) => (
            <Cell key={size} label={`size = ${size}`}>
              <FormField label={`${size} default`} htmlFor={`size-${size}`}>
                <Input size={size} placeholder="Placeholder" />
              </FormField>
              <FormField label={`${size} with leading icon`} htmlFor={`size-${size}-li`}>
                <Input size={size} placeholder="Search…" leadingIcon={Search} />
              </FormField>
            </Cell>
          ))}
        </Section>

        {/* ADORNMENTS */}
        <Section title="Input · adornments & types">
          <FormField label="Leading icon" htmlFor="demo-leading">
            <Input leadingIcon={Mail} type="email" placeholder="you@company.com" />
          </FormField>
          <FormField label="Trailing icon" htmlFor="demo-trailing">
            <Input trailingIcon={Lock} type="password" placeholder="••••••••" />
          </FormField>
          <FormField label="Both icons" htmlFor="demo-both">
            <Input leadingIcon={Search} trailingIcon={CalendarIcon} placeholder="Search dates…" />
          </FormField>
          <FormField label="Clearable" htmlFor="demo-clear" helper="Click X to clear">
            <Input
              value={clearable}
              onChange={(e) => setClearable(e.target.value)}
              onClear={() => setClearable("")}
            />
          </FormField>
          <FormField label="Prefix · currency" htmlFor="demo-prefix">
            <Input prefix="$" placeholder="0.00" type="number" />
          </FormField>
          <FormField label="Suffix · percent" htmlFor="demo-suffix">
            <Input suffix="%" placeholder="0" type="number" />
          </FormField>
          <FormField label="Phone" htmlFor="demo-phone">
            <Input leadingIcon={Phone} type="tel" placeholder="(555) 123-4567" />
          </FormField>
          <FormField label="Required" htmlFor="demo-required" required helper="* indicator">
            <Input placeholder="Required field" />
          </FormField>
        </Section>

        {/* TEXTAREA */}
        <Section title="Textarea">
          <FormField label="Default (rows=4)" htmlFor="demo-ta-1">
            <Textarea placeholder="Type a note…" />
          </FormField>
          <FormField label="With character count" htmlFor="demo-ta-2" helper="Soft warning at 90%, error at limit">
            <Textarea
              value={textareaValue}
              onChange={(e) => setTextareaValue(e.target.value)}
              maxLength={240}
              rows={4}
            />
          </FormField>
          <FormField label="With dictation (mic)" htmlFor="demo-ta-mic" helper="Mic icon bottom-right">
            <Textarea
              placeholder="Or dictate…"
              onMicClick={() => alert("Speech-to-text — wired in Session 9")}
            />
          </FormField>
          <FormField label="Error" htmlFor="demo-ta-error" error="Notes are required">
            <Textarea placeholder="…" />
          </FormField>
        </Section>

        {/* SELECT */}
        <Section title="Select">
          <FormField label="Default" htmlFor="demo-sel-1">
            <Select
              options={SAMPLE_OPTIONS}
              value={selectValue}
              onValueChange={setSelectValue}
              placeholder="Pick a profession…"
            />
          </FormField>
          <FormField label="Error" htmlFor="demo-sel-2" error="Please pick one">
            <Select options={SAMPLE_OPTIONS} placeholder="Pick a profession…" />
          </FormField>
          <FormField label="Disabled" htmlFor="demo-sel-3" disabled>
            <Select options={SAMPLE_OPTIONS} placeholder="Locked" disabled />
          </FormField>
          <FormField label="Pre-selected" htmlFor="demo-sel-4">
            <Select options={SAMPLE_OPTIONS} defaultValue="merchant" />
          </FormField>
        </Section>

        {/* CHECKBOX & TOGGLE */}
        <Section title="Checkbox · Toggle">
          <Cell label="checkbox">
            <Checkbox label="I agree to the terms" />
            <Checkbox
              label="Subscribe to product updates"
              helper="Monthly newsletter, no spam."
              checked={checkbox}
              onCheckedChange={setCheckbox}
            />
            <Checkbox label="Disabled, unchecked" disabled />
            <Checkbox label="Disabled, checked" defaultChecked disabled />
          </Cell>
          <Cell label="toggle (switch)">
            <Checkbox variant="toggle" label="Notifications" defaultChecked />
            <Checkbox
              variant="toggle"
              label="Dark mode"
              helper="Override system preference for navigatr only."
              checked={toggle}
              onCheckedChange={setToggle}
            />
            <Checkbox variant="toggle" label="Disabled, off" disabled />
            <Checkbox variant="toggle" label="Disabled, on" defaultChecked disabled />
          </Cell>
        </Section>
      </div>
    </main>
  );
}
