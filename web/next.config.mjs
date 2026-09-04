import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Sibling workspaces whose TypeScript this app compiles directly. */
const SHARED_DIR = path.resolve(dirname, "../shared");
const SERVER_DIR = path.resolve(dirname, "../server/src");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  webpack: (config, { defaultLoaders, isServer }) => {
    // The SLA engine lives in ../shared and is imported as TypeScript source so
    // the client's countdown and the server's deadlines come from one copy of
    // the code rather than two that can drift. TypeScript resolves this through
    // tsconfig `paths`, but webpack does not read those — hence the alias.
    config.resolve.alias["@shared"] = SHARED_DIR;

    // Those modules import each other with ESM-style ".js" specifiers, which is
    // what TypeScript wants for NodeNext output. Webpack has to be told that a
    // ".js" request may be satisfied by the ".ts" file sitting next to it.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };

    /**
     * Next's SWC loader only covers files inside this project's own directory,
     * so TypeScript imported from ../shared or ../server reaches webpack as
     * raw source and fails to parse. Registering the loader for those
     * directories is what lets the API be compiled as part of this build.
     */
    config.module.rules.push({
      test: /\.tsx?$/,
      include: [SHARED_DIR, SERVER_DIR],
      use: [defaultLoaders.babel],
    });

    // The API pulls in Node-only packages. They must never be traced into a
    // client bundle, and marking them external also keeps the server bundle
    // from rewriting their dynamic requires.
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        { mongoose: "commonjs mongoose", bcryptjs: "commonjs bcryptjs" },
      ];
    }

    return config;
  },
};

export default nextConfig;
