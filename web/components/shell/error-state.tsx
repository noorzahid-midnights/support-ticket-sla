"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  error?: Error | null;
  onRetry?: () => void;
  size?: "inline" | "page";
  className?: string;
}

/**
 * A failed request is not an empty list, and showing "No contacts yet" when
 * the API is down is how people delete things that were never missing.
 */
export function ErrorState({
  title = "Could not load this",
  error,
  onRetry,
  size = "page",
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        size === "page"
          ? "rounded-lg border border-dashed border-destructive/40 bg-destructive-subtle/40 px-6 py-14"
          : "px-4 py-8",
        className,
      )}
    >
      <div className="grid size-9 place-items-center rounded-full bg-destructive-subtle text-destructive">
        <AlertTriangle className="size-4" />
      </div>

      <div className="space-y-1">
        <p className="text-base font-medium">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {error?.message ?? "Something went wrong on the way to the server."}
        </p>
      </div>

      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw />
          Try again
        </Button>
      )}
    </div>
  );
}
