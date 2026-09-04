import mongoose from "mongoose";
import { env } from "./env.js";

/**
 * Connects to MongoDB.
 *
 * Atlas failures are usually one of three things — wrong password, IP not in
 * the access list, or a firewall eating the SRV lookup — and Mongoose's raw
 * error names none of them. The catch block translates rather than re-throws,
 * because "queryTxt ETIMEOUT" has never once told anyone what to do next.
 */
export async function connectDb(): Promise<void> {
  mongoose.set("strictQuery", true);

  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    const { host, name } = mongoose.connection;
    console.log(`[db] connected to ${name} at ${host}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("\n[db] could not connect to MongoDB.");
    console.error(`     ${message}\n`);

    if (/ETIMEOUT|ENOTFOUND|querySrv/i.test(message)) {
      console.error("     The SRV lookup failed. Usually a network or DNS block on port 27017,");
      console.error("     or a typo in the cluster hostname.");
    } else if (/authentication failed|bad auth/i.test(message)) {
      console.error("     Authentication was rejected. Check the username and password in");
      console.error("     MONGODB_URI, and remember the password must be URL-encoded.");
    } else if (/not allowed|IP address/i.test(message)) {
      console.error("     Your IP is not in the Atlas access list. Add it under");
      console.error("     Network Access, or allow 0.0.0.0/0 for a demo cluster.");
    }
    process.exit(1);
  }

  mongoose.connection.on("disconnected", () => console.warn("[db] disconnected"));
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
