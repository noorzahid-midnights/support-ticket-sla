/**
 * The seeded roster — the single source of truth for the client.
 *
 * This list previously existed in two places (the login screen and the sidebar
 * role switcher) and they drifted: one offered three accounts, the other four,
 * and Chi Nakamura appeared in neither despite owning two seeded tickets. One
 * exported list, imported everywhere, is what stops that happening again.
 *
 * It mirrors `server/src/seed.ts` exactly, so the same buttons work whether the
 * app is pointed at the mock fixtures or the real API.
 */

import type { Role, UserRef } from "@shared/types.js";

export interface DemoAccount extends UserRef {
  /** One line on what this account is useful for demonstrating. */
  blurb: string;
}

/** Every seeded account shares this password. The login screen says so. */
export const DEMO_PASSWORD = "password123";

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: "u-admin",
    name: "Admin Ahmed",
    email: "admin@helpdesk.test",
    role: "admin",
    blurb: "every ticket, the breach report and agent workload",
  },
  {
    id: "u-ana",
    name: "Ana Rivera",
    email: "ana@helpdesk.test",
    role: "agent",
    blurb: "the heaviest queue — three breaches on it",
  },
  {
    id: "u-ben",
    name: "Ben Okafor",
    email: "ben@helpdesk.test",
    role: "agent",
    blurb: "holds the at-risk ticket and a paused one",
  },
  {
    id: "u-chi",
    name: "Chi Nakamura",
    email: "chi@helpdesk.test",
    role: "agent",
    blurb: "the lightest load — wins the next auto-assignment",
  },
  {
    id: "u-dana",
    name: "Dana Whitfield",
    email: "dana@customer.test",
    role: "customer",
    blurb: "three tickets, two of them breached",
  },
  {
    id: "u-eli",
    name: "Eli Barros",
    email: "eli@customer.test",
    role: "customer",
    blurb: "raised the weekend ticket",
  },
  {
    id: "u-fay",
    name: "Fay Osei",
    email: "fay@customer.test",
    role: "customer",
    blurb: "raised the billing ticket that is at risk",
  },
];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  agent: "Agents",
  customer: "Customers",
};

/** Accounts grouped by role, in severity-of-access order. */
export function accountsByRole(): { role: Role; label: string; accounts: DemoAccount[] }[] {
  return (["admin", "agent", "customer"] as const)
    .map((role) => ({
      role,
      label: ROLE_LABEL[role],
      accounts: DEMO_ACCOUNTS.filter((a) => a.role === role),
    }))
    .filter((group) => group.accounts.length > 0);
}
