import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: false,
  devIndicators: false,
  allowedDevOrigins: ['web-ide.com'],
};

export default config;
