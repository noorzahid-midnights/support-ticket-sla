import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="text-center">
        <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold">That page does not exist</h1>
        <p className="mt-1 text-sm text-muted-foreground">The link may be stale, or the ticket may have been removed.</p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to the dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
