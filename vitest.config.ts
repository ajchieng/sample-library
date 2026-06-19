import { defineConfig } from "vitest/config";

// Unit tests cover pure logic (no DOM / no Tauri runtime), so the lightweight
// node environment is enough and keeps the suite fast.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
