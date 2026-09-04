"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const { data: me, isPending, error, refetch } = useMe();

  const unauthenticated = error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (!unauthenticated) return;
    // Carry the attempted path through, so a deep link survives signing in.
    const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${next}`);
  }, [unauthenticated, pathname, router]);

  // A failure that is not a 401 means the server is unwell — most often the
  // database being unreachable. Signing the user out would be a lie, and the
  // quiet hold below would leave them on a blank page indefinitely, so say so.
  if (error && !unauthenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-plane px-6">
        <div className="max-w-sm text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-full bg-sla-critical-bg text-sla-critical">
            <AlertTriangle className="size-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-lg font-semibold">Cannot reach the server</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {error instanceof ApiError && error.status >= 500
              ? "The service is up but something behind it is failing — usually the database."
              : error.message}
          </p>
          <Button className="mt-5" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  if (isPending || unauthenticated || !me) {
    // A quiet hold rather than a spinner: the redirect resolves in a frame or
    // two, and a flashing loader is worse than a still page.
    return <div className="min-h-screen bg-plane" aria-busy="true" />;
  }

  return <>{children}</>;
}
