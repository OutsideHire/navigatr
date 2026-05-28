/**
 * TabHeader — H1 + subtitle for a Settings hub tab.
 *
 * One shared component so every tab gets consistent title typography +
 * spacing. Matches the design critique mockup: 28px H1 (text-heading-xl
 * in our scale), muted subtitle directly underneath, generous bottom
 * spacing before the first section.
 */
export function TabHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="mb-6">
      <h1 className="text-heading-xl text-text-default">{title}</h1>
      {subtitle && (
        <p className="mt-1.5 text-body-md text-text-muted">{subtitle}</p>
      )}
    </header>
  );
}
