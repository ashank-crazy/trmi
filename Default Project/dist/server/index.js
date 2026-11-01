import { createGameServer } from './app.js';
import { sweepExpired } from './rooms.js';
// `npm run dev` passes --dev: Vite serves the client on PORT and proxies
// /socket.io here, so this server listens on SERVER_PORT instead.
const dev = process.argv.includes('--dev');
const { httpServer } = createGameServer({ serveClient: !dev });
setInterval(() => sweepExpired(), 5_000);
const portVar = dev ? 'SERVER_PORT' : 'PORT';
const PORT = Number(process.env[portVar]) || 3001;
httpServer.on('error', (err) => {
    if (err.code !== 'EADDRINUSE')
        throw err;
    console.error(`Port ${PORT} is already in use. Stop whatever is using it, or pick another port: ${portVar}=${PORT + 1}`);
    process.exit(1);
});
httpServer.listen(PORT, () => {
    console.log(`server listening on port ${PORT}${dev ? ' (dev)' : ''}`);
});
//# sourceMappingURL=index.js.map