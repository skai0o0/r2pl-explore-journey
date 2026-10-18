import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  server: {
    port: 5173,
    proxy: {
      "/colyseus": {
        target: "http://127.0.0.1:4176",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ""),
      },
      "/api": {
        target: "http://127.0.0.1:4176",
        changeOrigin: false,
      },
    },
  },
});
