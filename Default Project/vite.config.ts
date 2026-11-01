import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The game server's port in dev; must match what `npm run dev` gives the server.
const serverPort = Number(process.env.SERVER_PORT) || 3001;

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/socket.io': {
        target: `http://localhost:${serverPort}`,
        ws: true,
      },
    },
  },
});
