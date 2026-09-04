import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  /** One line. Say what would put something here, not that there is nothing. */
  description?: string;
  action?: React.ReactNode;
  /** `inline` for a slot inside a card or column, `page` for a whole view. */
  size?: "inline" | "page";
  className?: string;
}

/**
 * The one empty state.
 *
 * Every list in the app renders this rather than a bare "no data" string, and
 * a list with an active search renders a DIFFERENT copy of it - "nothing
 * matched" and "nothing exists yet" are different situations and want
 * different actions.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "page",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "page"
          ? "gap-3 rounded-lg border border-dashed border-border px-6 py-14"
          : "gap-2 px-4 py-8",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "grid place-items-center rounded-full bg-secondary text-muted-foreground",
            size === "page" ? "size-10" : "size-8",
          )}
        >
          <Icon className={size === "page" ? "size-5" : "size-4"} />
        </div>
      )}

      <div className="space-y-1">
        <p
          className={cn(
            "font-medium",
            size === "page" ? "text-base" : "text-sm",
          )}
        >
          {title}
        </p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
