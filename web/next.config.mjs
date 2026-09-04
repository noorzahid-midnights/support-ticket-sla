import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  webpack: (config) => {
    // The SLA engine lives in ../shared and is imported as TypeScript source so
    // the client's countdown and the server's deadlines come from one copy of
    // the code rather than two that can drift. TypeScript resolves this through
    // tsconfig `paths`, but webpack does not read those — hence the alias.
    config.resolve.alias["@shared"] = path.resolve(dirname, "../shared");

    // Those modules import each other with ESM-style ".js" specifiers, which is
    // what TypeScript wants for NodeNext output. Webpack has to be told that a
    // ".js" request may be satisfied by the ".ts" file sitting next to it.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };

    return config;
  },

  /**
   * Proxy the API through this app in deployment.
   *
   * The browser then only ever talks to one origin, so the auth cookie stays
   * first-party and `SameSite=Lax` keeps working. Calling the API on its own
   * domain instead makes every request cross-site, at which point the browser
   * silently drops the cookie and the app looks permanently signed out — with
   * no error anywhere, because nothing actually failed.
   *
   * Set API_ORIGIN to the backend's URL (server-side only, deliberately not
   * NEXT_PUBLIC_*) and leave NEXT_PUBLIC_API_BASE_URL empty so the client uses
   * same-origin paths. With API_ORIGIN unset this is a no-op, which is what
   * local development wants.
   */
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN;
    if (!apiOrigin) return [];
    return [{ source: "/api/:path*", destination: `${apiOrigin.replace(/\/$/, "")}/api/:path*` }];
  },
};

export default nextConfig;
