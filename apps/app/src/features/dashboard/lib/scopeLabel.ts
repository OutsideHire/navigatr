/**
 * scopeLabel — the dashboard's data scope for a viewer's role, made legible.
 * Once the org chart is populated, widgets scope automatically (via RLS); this
 * label tells the viewer whose data they're looking at.
 */
export function scopeLabel(role: "rep" | "manager" | "admin" | undefined): string | null {
  switch (role) {
    case "admin": return "Your organization";
    case "manager": return "Your team";
    case "rep": return "Your activity";
    default: return null;
  }
}
