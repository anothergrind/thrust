import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    // 3000 to match the CLIENT_ORIGIN the backend allows, and PORT so a host
    // (or the project's own tooling) can move it without editing this file.
    port: Number(process.env.PORT) || 3000,
  },
});
