/**
 * Visual catalog — Badge, Avatar, Chip, PhoneWithClickToCall,
 * NotesFieldWithMic, DispositionTile.
 *
 * Mounted at /component-preview/atoms. Compare against Figma:
 *   Badge                    24:26
 *   Avatar                   24:47
 *   Chip                     22:31
 *   PhoneWithClickToCall     51:131
 *   NotesFieldWithMic        52:24
 *   DispositionTile          60:88
 */

import { useState } from "react";
import {
  Sun, Moon, Monitor,
  Filter, Users,
  CheckCircle2, AlertCircle,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Chip,
  DispositionTile,
  NotesFieldWithMic,
  PhoneWithClickToCall,
  type AvatarSize,
  type BadgeKind,
  type DispositionTier,
  type MicState,
  type PhoneSize,
} from "@/components/navigatr";
import { useTheme, type Theme } from "@/stores/theme";

const NEXT_THEME: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
const THEME_LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

const BADGE_KINDS: BadgeKind[] = [
  "stage-new", "stage-contacted", "stage-qualified", "stage-proposal", "stage-won",
  "status-overdue", "status-due-soon", "status-on-track", "status-upcoming",
  "priority-high", "priority-medium", "priority-low",
];

const AVATAR_SIZES: AvatarSize[] = ["xs", "sm", "md", "lg", "xl"];

const SAMPLE_NAMES = [
  "Sarah Chen", "Marcus Thompson", "Priya Patel", "Diego Rivera",
  "Aisha Williams", "Kenji Tanaka", "Olivia Brooks", "Rashid Ahmed",
];

const PHONE_SIZES: PhoneSize[] = ["sm", "md", "lg"];

const DISPOSITION_TIERS: { tier: DispositionTier; title: string; description: string }[] = [
  { tier: "positive", title: "Statement Secured", description: "Highest urgency. Follow up tomorrow." },
  { tier: "neutral",  title: "Decision Maker Unavailable", description: "Retry in 3 business days." },
  { tier: "negative", title: "Not Interested", description: "Mark as closed-lost." },
  { tier: "cool",     title: "Future Potential", description: "Long-cycle. Follow up in 30 days." },
];

const MIC_STATES: MicState[] = ["rest", "recording", "permission-denied"];

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-radius-lg border border-border-subtle bg-surface-elevated p-6">
      <div>
        <h2 className="text-heading-md text-text-default">{title}</h2>
        {subtitle && <p className="mt-1 text-body-md text-text-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-eyebrow text-text-subtle">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function AtomsStories() {
  const theme = useTheme((s) => s.theme);
  const resolvedTheme = useTheme((s) => s.resolvedTheme);
  const setTheme = useTheme((s) => s.setTheme);
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set(["payroll"]));
  const [notes, setNotes] = useState("Met VP Finance — interested in Q2 onboarding. Follow up Tuesday.");
  const [selectedDisposition, setSelectedDisposition] = useState<DispositionTier | null>("positive");

  const toggleChip = (k: string) =>
    setSelectedChips((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  return (
    <main className="min-h-dvh bg-surface-canvas px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-eyebrow text-text-subtle">Component preview · Atoms</p>
            <h1 className="mt-1 text-heading-xl text-text-default">
              Badge · Avatar · Chip · PhoneWithClickToCall · NotesFieldWithMic · DispositionTile
            </h1>
            <p className="mt-2 max-w-3xl text-body-md text-text-muted">
              Figma sources:{" "}
              <code className="text-code text-text-default">24:26</code>,{" "}
              <code className="text-code text-text-default">24:47</code>,{" "}
              <code className="text-code text-text-default">22:31</code>,{" "}
              <code className="text-code text-text-default">51:131</code>,{" "}
              <code className="text-code text-text-default">52:24</code>,{" "}
              <code className="text-code text-text-default">60:88</code>.
            </p>
          </div>
          <Button variant="secondary" size="sm" leadingIcon={ThemeIcon} onClick={() => setTheme(NEXT_THEME[theme])}>
            Theme: {THEME_LABEL[theme]}<span className="text-text-subtle">({resolvedTheme})</span>
          </Button>
        </header>

        {/* BADGE */}
        <Section title="Badge — 12 kinds (Figma) × 2 sizes (md Figma + sm extrapolated)">
          <Cell label="md (Figma canonical)">
            {BADGE_KINDS.map((k) => (
              <Badge key={k} kind={k}>
                {k.replace(/^(stage|status|priority)-/, "").replace(/-/g, " ")}
              </Badge>
            ))}
          </Cell>
          <Cell label="sm (dense rows / tables)">
            {BADGE_KINDS.map((k) => (
              <Badge key={k} kind={k} size="sm">
                {k.replace(/^(stage|status|priority)-/, "").replace(/-/g, " ")}
              </Badge>
            ))}
          </Cell>
          <Cell label="with leading icon + removable (code-only extensions)">
            <Badge kind="status-on-track" leadingIcon={CheckCircle2}>On track</Badge>
            <Badge kind="status-overdue" leadingIcon={AlertCircle}>Overdue 3d</Badge>
            <Badge kind="stage-qualified" removable onRemove={() => alert("removed")}>Qualified</Badge>
          </Cell>
        </Section>

        {/* AVATAR */}
        <Section title="Avatar — 5 sizes × initials fallback + photo + status indicator">
          <Cell label="sizes — xs / sm / md / lg / xl (initials fallback, deterministic color by name)">
            {AVATAR_SIZES.map((s) => (
              <Avatar key={s} alt={SAMPLE_NAMES[0]!} size={s} />
            ))}
          </Cell>
          <Cell label="deterministic palette rotation — same name → same color">
            {SAMPLE_NAMES.map((n) => (
              <Avatar key={n} alt={n} size="md" />
            ))}
          </Cell>
          <Cell label="status indicators — online / away / offline">
            <Avatar alt="Sarah Chen" size="md" statusIndicator="online" />
            <Avatar alt="Marcus Thompson" size="md" statusIndicator="away" />
            <Avatar alt="Priya Patel" size="md" statusIndicator="offline" />
            <Avatar alt="Diego Rivera" size="lg" statusIndicator="online" />
            <Avatar alt="Aisha Williams" size="xl" statusIndicator="away" />
          </Cell>
          <Cell label="with photo (use a known-good image URL)">
            <Avatar alt="Octocat" size="md" src="https://github.githubassets.com/images/mona-loading-default.gif" />
            <Avatar alt="Octocat" size="lg" src="https://avatars.githubusercontent.com/u/9919" />
            <Avatar alt="Broken Link" size="md" src="https://example.com/this-will-404.png" />
            <span className="text-caption text-text-subtle">
              (broken-link example falls back to initials)
            </span>
          </Cell>
          <Cell label="shape = square">
            {AVATAR_SIZES.map((s) => (
              <Avatar key={s} alt="Octo Cat" size={s} shape="square" />
            ))}
          </Cell>
        </Section>

        {/* CHIP */}
        <Section title="Chip — rest / active / disabled, with leading icon, with count">
          <Cell label="filter row — click to toggle">
            {(["payroll", "merchant", "treasury"] as const).map((k) => (
              <Chip key={k} active={selectedChips.has(k)} onClick={() => toggleChip(k)} leadingIcon={Filter}>
                {k}
              </Chip>
            ))}
          </Cell>
          <Cell label="with count badge">
            <Chip count={12}>Overdue</Chip>
            <Chip active count={3}>Selected</Chip>
            <Chip count={147} leadingIcon={Users}>Leads</Chip>
            <Chip count={0} disabled>None</Chip>
          </Cell>
          <Cell label="sizes — sm / md">
            <Chip size="sm">sm rest</Chip>
            <Chip size="sm" active>sm active</Chip>
            <Chip size="md">md rest</Chip>
            <Chip size="md" active>md active</Chip>
            <Chip size="md" disabled>disabled</Chip>
          </Cell>
        </Section>

        {/* PHONE */}
        <Section title="PhoneWithClickToCall — 3 sizes (md Figma canonical) + valid / invalid / multi-number">
          <Cell label="sizes">
            {PHONE_SIZES.map((s) => (
              <PhoneWithClickToCall key={s} phoneNumber="+14155550142" size={s} />
            ))}
          </Cell>
          <Cell label="formats">
            <PhoneWithClickToCall phoneNumber="+14155550142" displayFormat="us" />
            <PhoneWithClickToCall phoneNumber="+14155550142" displayFormat="international" />
          </Cell>
          <Cell label="invalid + disabled">
            <PhoneWithClickToCall phoneNumber="not-a-number" />
            <PhoneWithClickToCall phoneNumber="+14155550142" disabled />
          </Cell>
          <Cell label="multi-number (chevron expands alternates)">
            <PhoneWithClickToCall
              phoneNumber="+14155550142"
              multiNumber
              alternateNumbers={[
                { label: "Direct line", phoneNumber: "+14155550199" },
                { label: "Mobile", phoneNumber: "+14155550210" },
                { label: "Front desk", phoneNumber: "+14155550111" },
              ]}
            />
          </Cell>
        </Section>

        {/* NOTES FIELD */}
        <Section title="NotesFieldWithMic — rest / recording / permission-denied">
          {MIC_STATES.map((state) => (
            <Cell key={state} label={`state = ${state}`}>
              <div className="w-full max-w-xl">
                <NotesFieldWithMic
                  value={notes}
                  onChange={setNotes}
                  micState={state}
                  maxLength={500}
                  onMicClick={() => alert(`mic clicked — would toggle ${state === "rest" ? "recording" : "rest"}`)}
                />
              </div>
            </Cell>
          ))}
        </Section>

        {/* DISPOSITION TILE */}
        <Section title="DispositionTile — 4 tiers · selected + unselected + disabled">
          <Cell label="4 tiers (click to select)">
            <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
              {DISPOSITION_TIERS.map((d) => (
                <DispositionTile
                  key={d.tier}
                  tier={d.tier}
                  title={d.title}
                  description={d.description}
                  selected={selectedDisposition === d.tier}
                  onClick={() => setSelectedDisposition(d.tier)}
                />
              ))}
            </div>
          </Cell>
          <Cell label="disabled examples">
            <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
              <DispositionTile
                tier="negative"
                title="Closed Lost"
                description="Marks the deal lost permanently."
                disabled
              />
              <DispositionTile
                tier="positive"
                title="Statement Secured"
                description="Selected and locked."
                selected
                disabled
              />
            </div>
          </Cell>
        </Section>
      </div>
    </main>
  );
}
