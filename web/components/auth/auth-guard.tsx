"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError } from "@shared/types.js";
import { useMe } from "@/hooks/use-tickets";

/**
 * Gate for every signed-in route.
 *
 * The check is `auth.me()` failing with a 401 rather than anything held on the
 * client: the token lives in an httpOnly cookie that JavaScript cannot read, so
 * the server's answer is the only honest source of truth about whether the
 * session is still valid.
 *
 * This is a convenience redirect, not the security boundary — every endpoint
 * enforces its own auth and role checks server-side. Rendering nothing here
 * would be pointless protection on its own.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me, isPending, error } = useMe();

  const unauthenticated = error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (!unauthenticated) return;
    // Carry the attempted path through, so a deep link survives signing in.
    const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${next}`);
  }, [unauthenticated, pathname, router]);

  if (isPending || unauthenticated || !me) {
    // A quiet hold rather than a spinner: the redirect resolves in a frame or
    // two, and a flashing loader is worse than a still page.
    return <div className="min-h-screen bg-plane" aria-busy="true" />;
  }

  return <>{children}</>;
}
