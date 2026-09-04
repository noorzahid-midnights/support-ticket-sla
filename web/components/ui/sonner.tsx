"use client";

import { Toaster as Sonner } from "sonner";

/**
 * Toasts. Used for one thing above all: telling someone a drag did NOT save.
 * Styled through the same tokens as everything else rather than sonner's
 * defaults, so it does not look like a third-party widget.
 */
export function Toaster(props: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group flex items-center gap-2 rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground shadow-pop",
          description: "text-muted-foreground",
          actionButton:
            "rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground",
          cancelButton:
            "rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground",
          error: "text-destructive",
          success: "text-success",
        },
      }}
      {...props}
    />
  );
}
