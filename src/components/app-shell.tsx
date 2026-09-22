"use client";

import {
  IconCalendarEvent,
  IconHistory,
  IconLogout,
  IconShieldLock,
  IconMoon,
  IconSettings,
  IconSun,
  IconWashMachine,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useHouse } from "@/components/providers/house-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Now", icon: IconWashMachine },
  { href: "/bookings", label: "Bookings", icon: IconCalendarEvent },
  { href: "/history", label: "History", icon: IconHistory },
  { href: "/settings", label: "Settings", icon: IconSettings },
] as const;

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is unknown on the server, so render a neutral icon until hydrated.
  const mounted = useSyncExternalStore(
    () => () => {
      // Nothing to unsubscribe from: this store never changes after the first render.
    },
    () => true,
    () => false,
  );

  const isDark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <IconMoon /> : <IconSun />}
    </Button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();
  const { house, member, isAdmin } = useHouse();

  const nav = NAV;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="bg-background/85 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3">
          <IconWashMachine className="text-primary size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{house?.name ?? "Laundry"}</p>
            {member && (
              <p className="text-muted-foreground truncate text-xs">
                {member.displayName} · {member.group}
                {isAdmin ? " · Admin" : ""}
              </p>
            )}
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <Button
                key={item.href}
                asChild
                size="sm"
                variant={pathname === item.href ? "secondary" : "ghost"}
              >
                <Link href={item.href}>
                  <item.icon />
                  {item.label}
                </Link>
              </Button>
            ))}
          </nav>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Account menu">
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">
                    {initials(member?.displayName ?? "?")}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate font-normal">
                <span className="block font-medium">{member?.displayName}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {member?.email}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/privacy">
                  <IconShieldLock />
                  Privacy
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  await signOut();
                  router.replace("/login");
                }}
              >
                <IconLogout />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-3 px-4 pt-4 pb-24 md:pb-10">
        {children}
      </main>

      <nav className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-3xl">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
