/**
 * Visual catalog — Card, CardWithStatusBand, KpiCard, ListRow.
 *
 * Mounted at /component-preview/cards. Compare against Figma:
 *   Card                  49:11
 *   CardWithStatusBand    49:37
 *   KpiCard               50:98
 *   ListRow               51:110
 */

import {
  Sun,
  Moon,
  Monitor,
  Activity,
  DollarSign,
  Users,
  TrendingUp,
  Building2,
  Compass,
  ChevronRight,
  MoreHorizontal,
  Mail,
  Calendar,
  Phone,
} from "lucide-react";
import {
  Button,
  Card,
  CardWithStatusBand,
  KpiCard,
  ListRow,
  Checkbox,
  type BandColor,
  type KpiAccent,
} from "@/components/navigatr";
import { useTheme, type Theme } from "@/stores/theme";

const NEXT_THEME: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
const THEME_LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

const BAND_COLORS: BandColor[] = [
  "success",
  "warning",
  "danger",
  "info",
  "brand",
  "teal",
  "violet",
  "orange",
  "blue",
  "pink",
];

const KPI_ACCENTS: KpiAccent[] = ["teal", "violet", "blue", "orange", "indigo", "pink"];

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
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
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-heading-sm text-text-default">{children}</h3>;
}
function CardBody({ children }: { children: React.ReactNode }) {
  return <p className="text-body-md text-text-muted">{children}</p>;
}

export function CardStories() {
  const theme = useTheme((s) => s.theme);
  const resolvedTheme = useTheme((s) => s.resolvedTheme);
  const setTheme = useTheme((s) => s.setTheme);
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <main className="min-h-dvh bg-surface-canvas px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-eyebrow text-text-subtle">Component preview · Cards & ListRow</p>
            <h1 className="mt-1 text-heading-xl text-text-default">Surfaces backbone</h1>
            <p className="mt-2 max-w-3xl text-body-md text-text-muted">
              Sourced from Figma <code className="text-code text-text-default">49:11</code> (Card),
              {" "}<code className="text-code text-text-default">49:37</code> (CardWithStatusBand),
              {" "}<code className="text-code text-text-default">50:98</code> (KpiCard),
              {" "}<code className="text-code text-text-default">51:110</code> (ListRow). Drift flags
              in the commit message.
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

        {/* CARD */}
        <Section
          title="Card"
          subtitle="surface × padding × border × shadow × radius × interactive."
        >
          <Cell label="surface variants">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card surface="default">
                <CardTitle>surface=default</CardTitle>
                <CardBody>Canonical Figma surface.</CardBody>
              </Card>
              <Card surface="elevated">
                <CardTitle>surface=elevated</CardTitle>
                <CardBody>Light-mode same as default; differs in dark.</CardBody>
              </Card>
              <Card surface="sunken">
                <CardTitle>surface=sunken</CardTitle>
                <CardBody>Used for inner panels.</CardBody>
              </Card>
            </div>
          </Cell>

          <Cell label="padding scale (none / sm / md / lg / xl)">
            <div className="grid gap-3 sm:grid-cols-5">
              {(["none", "sm", "md", "lg", "xl"] as const).map((p) => (
                <Card key={p} padding={p}>
                  <span className="text-caption text-text-muted">padding={p}</span>
                </Card>
              ))}
            </div>
          </Cell>

          <Cell label="shadows (none / sm / md / lg)">
            <div className="grid gap-3 sm:grid-cols-4">
              <Card shadow="none"><CardTitle>none</CardTitle></Card>
              <Card shadow="sm"><CardTitle>sm — Figma rest</CardTitle></Card>
              <Card shadow="md"><CardTitle>md — Figma hover</CardTitle></Card>
              <Card shadow="lg"><CardTitle>lg</CardTitle></Card>
            </div>
          </Cell>

          <Cell label="interactive (onClick → button semantics, hover shadow, focus ring)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Card onClick={() => alert("clicked")}>
                <CardTitle>Click me</CardTitle>
                <CardBody>Renders as &lt;button&gt;. Try keyboard tab + Enter.</CardBody>
              </Card>
              <Card onClick={() => {}} disabled>
                <CardTitle>Disabled</CardTitle>
                <CardBody>opacity-50, no pointer events.</CardBody>
              </Card>
            </div>
          </Cell>
        </Section>

        {/* CARD WITH STATUS BAND */}
        <Section
          title="CardWithStatusBand"
          subtitle="5 band colors in Figma (success, warning, danger, info, brand) + 5 accent extensions (teal, violet, orange, blue, pink) — flagged for reverse-import."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {BAND_COLORS.map((band) => (
              <CardWithStatusBand key={band} bandColor={band}>
                <CardTitle>band={band}</CardTitle>
                <CardBody>
                  {band === "success" && "Statement Secured · today"}
                  {band === "warning" && "Follow-up due in 2 days"}
                  {band === "danger" && "Connection lost — needs reconnect"}
                  {band === "info" && "Heads-up: new ICP rule live"}
                  {band === "brand" && "Hero brand surface"}
                  {band === "teal" && "Pipeline — Acme Co · $42K"}
                  {band === "violet" && "Forecast — strong quarter"}
                  {band === "orange" && "Win-rate dipped — investigate"}
                  {band === "blue" && "Path generated · 24 stops"}
                  {band === "pink" && "New partner submitted lead"}
                </CardBody>
              </CardWithStatusBand>
            ))}
          </div>
        </Section>

        {/* KPI CARD */}
        <Section title="KpiCard — accents × sizes">
          <Cell label="standard size, 6 accents">
            <div className="grid gap-3 sm:grid-cols-3">
              {KPI_ACCENTS.map((acc) => (
                <KpiCard
                  key={`std-${acc}`}
                  eyebrow={`${acc.toUpperCase()} PIPELINE`}
                  value="$1,284,500"
                  subtitle="Weighted: $312K"
                  trend={{ direction: "up", label: "+12.4%", isPositive: true }}
                  icon={DollarSign}
                  accent={acc}
                  size="standard"
                />
              ))}
            </div>
          </Cell>
          <Cell label="hero size">
            <div className="grid gap-3 sm:grid-cols-2">
              <KpiCard
                eyebrow="ACTIVE DEALS"
                value="247"
                subtitle="across 3 territories"
                trend={{ direction: "up", label: "+8 this week", isPositive: true }}
                icon={Building2}
                accent="violet"
                size="hero"
              />
              <KpiCard
                eyebrow="WIN RATE"
                value="34%"
                subtitle="Last 90 days"
                trend={{ direction: "down", label: "−2.1%", isPositive: false }}
                icon={TrendingUp}
                accent="orange"
                size="hero"
              />
            </div>
          </Cell>
          <Cell label="gradient variant — marquee Activities-to-Win (the only gradient KPI per DESIGN.md)">
            <div className="grid gap-3 sm:grid-cols-2">
              <KpiCard
                eyebrow="ACTIVITIES TO WIN"
                value="1,247"
                subtitle="Goal: 1,500 by EoQ"
                trend={{ direction: "up", label: "+12.4%", isPositive: true }}
                icon={Activity}
                size="hero"
                gradient
              />
              <KpiCard
                eyebrow="ACTIVITIES TO WIN"
                value="412"
                size="standard"
                gradient
                icon={Activity}
              />
            </div>
          </Cell>
          <Cell label="minimal — no trend, no subtitle">
            <div className="grid gap-3 sm:grid-cols-4">
              <KpiCard eyebrow="LEADS" value="48" accent="teal" icon={Users} size="standard" />
              <KpiCard eyebrow="CALLS"   value="92"  accent="blue" icon={Phone} size="standard" />
              <KpiCard eyebrow="EMAILS"  value="312" accent="indigo" icon={Mail} size="standard" />
              <KpiCard eyebrow="MEETINGS" value="17" accent="pink" icon={Calendar} size="standard" />
            </div>
          </Cell>
          <Cell label="clickable">
            <div className="grid gap-3 sm:grid-cols-2">
              <KpiCard
                eyebrow="OPEN DEALS"
                value="84"
                subtitle="Click to view pipeline →"
                icon={DollarSign}
                accent="teal"
                onClick={() => alert("navigating to /pipeline")}
              />
            </div>
          </Cell>
        </Section>

        {/* LIST ROW */}
        <Section title="ListRow — leading × trailing combinations">
          <Cell label="inside a Card with internal dividers (no `divider` prop — Card handles the surface)">
            <Card padding="none">
              <ListRow
                leading={
                  <span className="flex h-8 w-8 items-center justify-center rounded-radius-full bg-accent-teal-20 text-accent-teal">
                    <Phone className="h-4 w-4" />
                  </span>
                }
                title="Call · Sarah at Acme Co"
                subtitle="2:14pm · 8m call · positive engagement"
                trailing={
                  <span className="rounded-radius-sm bg-status-success-bg px-2 py-0.5 text-caption font-medium text-status-success">
                    Statement Secured
                  </span>
                }
                divider
                onClick={() => {}}
              />
              <ListRow
                leading={
                  <span className="flex h-8 w-8 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
                    <Mail className="h-4 w-4" />
                  </span>
                }
                title="Email · Follow up on proposal"
                subtitle="Sent 1:02pm · awaiting reply"
                trailing={<ChevronRight className="h-5 w-5 text-text-subtle" />}
                divider
                onClick={() => {}}
              />
              <ListRow
                leading={
                  <span className="flex h-8 w-8 items-center justify-center rounded-radius-full bg-accent-orange-20 text-accent-orange">
                    <Compass className="h-4 w-4" />
                  </span>
                }
                title="Drop-in · Bridgepoint Capital"
                subtitle="11:47am · 23m · met with VP Finance"
                trailing={<MoreHorizontal className="h-5 w-5 text-text-subtle" />}
                onClick={() => {}}
              />
            </Card>
          </Cell>

          <Cell label="status indicator (12px dot) + chevron — settings rows">
            <Card padding="none">
              <ListRow
                leading={<span className="h-3 w-3 rounded-radius-full bg-status-success" />}
                title="Salesforce"
                subtitle="Connected · last sync 12m ago"
                trailing={<ChevronRight className="h-5 w-5 text-text-subtle" />}
                divider
                onClick={() => {}}
              />
              <ListRow
                leading={<span className="h-3 w-3 rounded-radius-full bg-status-warning" />}
                title="HubSpot"
                subtitle="Token expires in 3 days"
                trailing={<ChevronRight className="h-5 w-5 text-text-subtle" />}
                divider
                onClick={() => {}}
              />
              <ListRow
                leading={<span className="h-3 w-3 rounded-radius-full bg-status-danger" />}
                title="Gmail"
                subtitle="Disconnected — needs reconnect"
                trailing={<ChevronRight className="h-5 w-5 text-text-subtle" />}
                onClick={() => {}}
              />
            </Card>
          </Cell>

          <Cell label="checkbox leading + action trailing">
            <Card padding="none">
              <ListRow
                leading={<Checkbox aria-label="Select deal" />}
                title="Acme Co · $42,000"
                subtitle="Stage: Proposal · Owner: Jamie R."
                trailing={
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-radius-sm bg-surface-sunken text-text-muted hover:bg-surface-elevated"
                    aria-label="More"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                }
                divider
              />
              <ListRow
                leading={<Checkbox aria-label="Select deal" defaultChecked />}
                title="Northgate Logistics · $128,000"
                subtitle="Stage: Qualified · Owner: Marcus T."
              />
            </Card>
          </Cell>

          <Cell label="no leading + badge trailing (standalone, no Card)">
            <ListRow
              title="Profile completion"
              subtitle="3 of 5 fields filled"
              trailing={
                <span className="rounded-radius-sm bg-status-info-bg px-2 py-0.5 text-caption font-medium text-status-info">
                  60%
                </span>
              }
              divider
            />
            <ListRow
              title="Disabled row example"
              subtitle="Can't interact"
              trailing={<ChevronRight className="h-5 w-5 text-text-subtle" />}
              onClick={() => {}}
              disabled
            />
          </Cell>
        </Section>
      </div>
    </main>
  );
}
