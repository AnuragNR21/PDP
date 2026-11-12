import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        // Local API
        target: "http://127.0.0.1:8000",
        // Sandbox API
        // target: "https://pgezstywkm.ap-southeast-2.awsapprunner.com",
        changeOrigin: true
      }
    }
  }
});
