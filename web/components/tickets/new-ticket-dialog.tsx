"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateTicket } from "@/hooks/use-tickets";

export function NewTicketDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const create = useCreateTicket();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (subject.trim().length < 3 || body.trim().length === 0) return;

    create.mutate(
      { subject: subject.trim(), body: body.trim() },
      {
        onSuccess: (ticket) => {
          setSubject("");
          setBody("");
          onOpenChange(false);
          router.push(`/tickets/${ticket.id}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New ticket</DialogTitle>
            <DialogDescription>
              Priority and assignee are chosen automatically — you do not need to pick either.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Checkout is returning a 500"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="body">What is happening?</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Describe the problem, when it started, and who it affects."
              />
            </div>

            {/* Tells the user why the priority they get may not be the one they
                expected, before they get it. */}
            {/* The flex container holds exactly two children — icon and text.
                Putting the sentence directly in a flex parent makes every
                <strong> and text fragment its own flex item, which breaks the
                line into columns instead of letting it wrap as prose. */}
            <div className="flex items-start gap-2 rounded-md bg-secondary px-3 py-2">
              <Sparkles className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-2xs leading-relaxed text-muted-foreground">
                Words like <strong className="font-medium text-foreground">down</strong>,{" "}
                <strong className="font-medium text-foreground">outage</strong> or{" "}
                <strong className="font-medium text-foreground">can&apos;t login</strong> raise the priority
                automatically. The SLA clock counts business hours only, and pauses whenever we are waiting on you.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || subject.trim().length < 3 || !body.trim()}>
              {create.isPending ? "Creating…" : "Create ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
