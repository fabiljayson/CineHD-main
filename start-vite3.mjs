import {createServer} from './node_modules/vite/dist/node/index.js';
const server = await createServer({
  server: { host: '127.0.0.1', port: 5173, strictPort: false }
});
await server.listen();
server.printUrls();
process.stdin.resume();
