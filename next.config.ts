import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Self-hosted on Oracle via PM2 + Caddy. Standalone bundles the
  // server.js + minimal node_modules so the rsync deploy stays cheap.
  output: 'standalone',
  // better-sqlite3 is a native module — Next must not bundle it.
  serverExternalPackages: ['better-sqlite3'],
}

export default nextConfig
