/**
 * Cron wrapper around the breach sweep.
 *
 * node-cron rather than BullMQ: BullMQ needs Redis, which is a second piece of
 * infrastructure to provision and keep alive for what is one indexed query a
 * minute over a small collection. The honest trade-off is that this runs
 * in-process, so two server instances would each sweep and would need a lock
 * (or a real queue) before this scales horizontally.
 */

import cron from "node-cron";
import { env } from "../env.js";
import { runSlaSweep } from "../services/escalation.service.js";

let running = false;

export function startSlaSweep(): void {
  if (!env.SLA_SWEEP_ENABLED) {
    console.log("[sla] sweep disabled (SLA_SWEEP_ENABLED=0)");
    return;
  }

  if (!cron.validate(env.SLA_SWEEP_CRON)) {
    console.error(`[sla] invalid SLA_SWEEP_CRON "${env.SLA_SWEEP_CRON}"; sweep not started.`);
    return;
  }

  cron.schedule(env.SLA_SWEEP_CRON, async () => {
    // A slow pass must not overlap the next tick: two concurrent sweeps could
    // both read a ticket before either latches its breach flag, and escalate
    // it twice.
    if (running) {
      console.warn("[sla] previous sweep still running, skipping this tick");
      return;
    }
    running = true;
    try {
      const result = await runSlaSweep();
      if (result.breached > 0) {
        console.log(
          `[sla] swept ${result.checked} tickets: ${result.breached} newly breached, ` +
            `${result.escalated} escalated, ${result.atCeiling} already at top priority`,
        );
      }
    } catch (error) {
      // Never let a bad pass kill the schedule; the next tick should try again.
      console.error("[sla] sweep failed:", error);
    } finally {
      running = false;
    }
  });

  console.log(`[sla] breach sweep scheduled (${env.SLA_SWEEP_CRON})`);
}
