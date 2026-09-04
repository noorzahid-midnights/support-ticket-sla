import type { Metadata } from "next";
import { WorkloadView } from "@/components/admin/workload-view";

export const metadata: Metadata = { title: "Agent workload" };

export default function AgentsPage() {
  return <WorkloadView />;
}
