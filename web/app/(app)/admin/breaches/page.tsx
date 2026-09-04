import type { Metadata } from "next";
import { BreachesView } from "@/components/admin/breaches-view";

export const metadata: Metadata = { title: "SLA breaches" };

export default function BreachesPage() {
  return <BreachesView />;
}
