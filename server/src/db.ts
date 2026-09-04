import mongoose from "mongoose";
import { env } from "./env.js";

/**
 * Cached connection, shared across warm serverless invocations.
 *
 * A serverless function is re-entered many times per container, and calling
 * `mongoose.connect` on each one opens a fresh pool. Atlas's shared tiers cap
 * connections at 500, so an uncached handler under any real traffic exhausts
 * the cluster and starts refusing everything — including the requests that
 * were already working. Hanging the promise off `globalThis` means the second
 * and subsequent invocations reuse the first one's connection.
 *
 * It stores the *promise*, not the resolved connection, so that concurrent
 * cold starts wait on one attempt rather than racing to open several.
 */
const globalForMongoose = globalThis as unknown as {
  __slaMongoose?: Promise<typeof mongoose> | undefined;
};

function explain(message: string): void {
  console.error("\n[db] could not connect to MongoDB.");
  console.error(`     ${message}\n`);

  // Mongoose's raw errors name the symptom, never the cause. These three
  // account for almost every failed connection in practice.
  if (/ETIMEOUT|ENOTFOUND|querySrv/i.test(message)) {
    console.error("     The SRV lookup failed. Usually a network or DNS block on port 27017,");
    console.error("     or a typo in the cluster hostname.");
  } else if (/authentication failed|bad auth/i.test(message)) {
    console.error("     Authentication was rejected. Check the username and password in");
    console.error("     MONGODB_URI, and remember the password must be URL-encoded.");
  } else if (/not allowed|IP address/i.test(message)) {
    console.error("     The connecting IP is not in the Atlas access list. Add it under");
    console.error("     Network Access — a serverless host needs 0.0.0.0/0, since its");
    console.error("     egress IP is not stable.");
  }
}

/**
 * Connects, or returns the in-flight//established connection.
 *
 * Safe to call on every request: after the first success it resolves
 * immediately from the cache.
 */
export async function connectDb(): Promise<void> {
  mongoose.set("strictQuery", true);

  if (!globalForMongoose.__slaMongoose) {
    globalForMongoose.__slaMongoose = mongoose
      .connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 15_000,
        // Keep the per-container pool small: many containers each holding a
        // large pool is exactly how the 500-connection cap gets hit.
        maxPoolSize: 10,
      })
      .catch((error) => {
        // Drop the rejected promise so the next invocation retries rather than
        // caching the failure for the life of the container.
        globalForMongoose.__slaMongoose = undefined;
        throw error;
      });
  }

  try {
    await globalForMongoose.__slaMongoose;
  } catch (error) {
    explain(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Connects for the long-running server, retrying before giving up.
 *
 * A single attempt is too brittle: a DNS hiccup, an Atlas failover, a cold
 * container, or a file-watcher restart that aborts the in-flight handshake
 * would all take the process down permanently. None of those are unrecoverable
 * — they just need a second try a moment later.
 */
export async function connectDbOrExit(attempts = 4): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await connectDb();
      const { host, name } = mongoose.connection;
      console.log(`[db] connected to ${name} at ${host}`);
      mongoose.connection.on("disconnected", () => console.warn("[db] disconnected"));
      return;
    } catch {
      if (attempt === attempts) {
        console.error(`[db] giving up after ${attempts} attempts.`);
        process.exit(1);
      }
      const waitMs = attempt * 2000;
      console.warn(`[db] attempt ${attempt}/${attempts} failed; retrying in ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export async function disconnectDb(): Promise<void> {
  globalForMongoose.__slaMongoose = undefined;
  await mongoose.disconnect();
}
