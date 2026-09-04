import { TicketDetailView } from "@/components/tickets/ticket-detail-view";

export default function TicketPage({ params }: { params: { id: string } }) {
  return <TicketDetailView id={params.id} />;
}
