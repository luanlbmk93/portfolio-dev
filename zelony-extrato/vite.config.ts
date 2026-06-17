import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Backend que expõe /api/login, /api/me, /api/admin-users, /api/audit-logs, /api/proxy-gemini, etc.
  // Em DEV: o Vite vai encaminhar /api/* para esse alvo.
  // Em PROD: ideal é o Nginx do servidor fazer o reverse proxy (mesmo domínio).
  const apiTarget = (env.VITE_API_PROXY_TARGET || "http://localhost:3000").trim();
  const statementTarget = (
    env.VITE_STATEMENT_PROXY_TARGET ||
    env.VITE_STATEMENT_API_URL ||
    "http://127.0.0.1:8000"
  ).trim();

  return {
    plugins: [react()],
    optimizeDeps: {
      exclude: ["lucide-react"],
    },
    server: {
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
        "/parse-statement": {
          target: statementTarget,
          changeOrigin: true,
          secure: false,
          timeout: 600_000,
          proxyTimeout: 600_000,
        },
        "/health": {
          target: statementTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
