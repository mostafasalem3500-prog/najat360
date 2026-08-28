/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Demo-only app: no image optimization surface, no i18n rewrites, no
  // custom middleware — deliberately keeps this app clear of the Next.js
  // advisory surface area that mostly affects those subsystems (see
  // README's "known limitations" section for the full note on why this
  // project stays on the Next 14.x line rather than jumping to 16).
  images: { unoptimized: true },
};

export default nextConfig;
