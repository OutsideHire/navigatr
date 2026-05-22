/**
 * navigatr TopBar — responsive top navigation.
 *
 * Sources:
 *   - Figma `Top bar (mobile)`  57:2   — 360 × 56, padding 12/16, gap 12
 *                                       Logo (mark 28 + wordmark heading/sm 16)
 *                                       Right: search icon button + Avatar 32
 *   - Figma `Top bar (desktop)` 57:11  — 1280 × 64, padding 12/24, gap 16
 *                                       Logo (mark 32 + wordmark heading/md 20)
 *                                       Center-right: search-inline 480 × 40
 *                                       Right: Avatar
 *
 * Both: surface/default fill, border/subtle 1 px bottom stroke.
 *
 * The avatar opens a DropdownMenu with Profile / Settings / theme cycle /
 * Sign out. Theme cycle is wired to the Session-2 theme store (light → dark
 * → system → light); dark-mode toggling now works from inside the
 * authenticated app, not just the demo pages.
 */

import { ChevronLeft, LogOut, Moon, Search, Settings as SettingsIcon, Sun, Monitor, User as UserIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Avatar, Input } from "@/components/navigatr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type Theme } from "@/stores/theme";
import { useAuth } from "@/stores/auth";
import { Logo } from "./Logo";
import { NotificationsBell } from "./NotificationsBell";

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};
const THEME_LABEL: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export interface TopBarUser {
  fullName: string;
  email?: string;
  avatarUrl?: string;
}

export interface TopBarProps {
  /** Show the desktop center-right search input. Defaults to true. */
  showSearch?: boolean;
  /** Render a back-chevron left of the logo. Off by default. */
  showBack?: boolean;
  onBack?: () => void;
  /** White-label override for the brand mark. */
  tenantLogo?: string;
  /** White-label override for the brand wordmark. */
  tenantAppName?: string;
  /** Signed-in user. Pass `null` to render the bar without an avatar/menu. */
  user?: TopBarUser | null;
  /** Override the default sign-out behavior (defaults to Supabase signOut). */
  onSignOut?: () => void;
  /** Forward className for outer wrapper overrides. */
  className?: string;
}

export function TopBar({
  showSearch = true,
  showBack = false,
  onBack,
  tenantLogo,
  tenantAppName = "navigatr",
  user,
  onSignOut,
  className,
}: TopBarProps) {
  const theme = useTheme((s) => s.theme);
  const resolvedTheme = useTheme((s) => s.resolvedTheme);
  const setTheme = useTheme((s) => s.setTheme);
  const signOut = useAuth((s) => s.signOut);
  const navigate = useNavigate();

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  const handleSignOut = async () => {
    if (onSignOut) return onSignOut();
    try {
      await signOut();
      toast.success("Signed out.");
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sign out");
    }
  };

  // Shared chrome — the outer bar with padding and border.
  return (
    <header
      className={cn(
        "sticky top-0 z-30 w-full border-b border-border-subtle bg-surface-default",
        "supports-[backdrop-filter]:bg-surface-default/95 supports-[backdrop-filter]:backdrop-blur",
        className,
      )}
    >
      {/* ===== MOBILE (Figma 57:2): 56 px, padding 12/16, gap 12 ===== */}
      <div className="flex h-14 items-center gap-3 px-4 md:hidden">
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-radius-sm text-text-default hover:bg-surface-sunken"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        <Logo size="sm" wordmark={tenantAppName} logoSrc={tenantLogo} />

        <div className="ml-auto flex items-center gap-1">
          {/* Mobile search icon — opens a sheet on tap (Session 11+). For now,
              we just navigate to a future /search route or no-op. */}
          <button
            type="button"
            aria-label="Search"
            className="inline-flex h-9 w-9 items-center justify-center rounded-radius-sm text-text-default hover:bg-surface-sunken"
            onClick={() => toast("Search lands in a later session")}
          >
            <Search className="h-5 w-5" />
          </button>
          {user && <NotificationsBell />}
          {user && <AvatarMenu user={user} theme={theme} resolvedTheme={resolvedTheme} setTheme={setTheme} ThemeIcon={ThemeIcon} handleSignOut={handleSignOut} />}
        </div>
      </div>

      {/* ===== DESKTOP (Figma 57:11): 64 px, padding 12/24, gap 16 ===== */}
      <div className="hidden h-16 items-center gap-4 px-6 md:flex">
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-radius-sm text-text-default hover:bg-surface-sunken"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        <Logo size="md" wordmark={tenantAppName} logoSrc={tenantLogo} />

        {showSearch && (
          <div className="ml-6 max-w-[480px] flex-1">
            <Input
              size="md"
              leadingIcon={Search}
              placeholder="Search deals, partners, activities…"
              aria-label="Search"
            />
          </div>
        )}

        {user && (
          <div className="ml-auto flex items-center gap-3">
            <NotificationsBell />
            <AvatarMenu user={user} theme={theme} resolvedTheme={resolvedTheme} setTheme={setTheme} ThemeIcon={ThemeIcon} handleSignOut={handleSignOut} desktop />
          </div>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Avatar dropdown menu (shared between mobile + desktop)
// ---------------------------------------------------------------------------

interface AvatarMenuProps {
  user: TopBarUser;
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (t: Theme) => void;
  ThemeIcon: typeof Sun;
  handleSignOut: () => void;
  desktop?: boolean;
}

function AvatarMenu({ user, theme, resolvedTheme, setTheme, ThemeIcon, handleSignOut, desktop }: AvatarMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-radius-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
        >
          <Avatar
            alt={user.fullName}
            src={user.avatarUrl}
            size={desktop ? "md" : "sm"}
            statusIndicator="online"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuLabel className="flex flex-col gap-0.5 normal-case tracking-normal">
          <span className="text-body-strong text-text-default">{user.fullName}</span>
          {user.email && <span className="text-caption text-text-muted">{user.email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => toast("Profile lands in a later session")}>
          <UserIcon />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toast("Settings page lands in this session — try /settings")}>
          <SettingsIcon />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            // Prevent menu close so the icon update is visible? No — let it close.
            e.preventDefault();
            setTheme(NEXT_THEME[theme]);
          }}
        >
          <ThemeIcon />
          <span className="flex-1">Theme: {THEME_LABEL[theme]}</span>
          <span className="text-caption text-text-subtle">{resolvedTheme}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default TopBar;
