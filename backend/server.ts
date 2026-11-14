import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInsuranceServer } from './insurance/server.js';
import { createLendingServer } from './lending/server.ts';

export function createAppServer({ databasePath = ':memory:' } = {}) {
  const insurance = createInsuranceServer({ databasePath });
  const lending = createLendingServer({ apiKey: process.env.SARVAM_API_KEY });
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const isLending = pathname === '/lending' || pathname.startsWith('/lending/') ||
      pathname === '/health' || pathname === '/applications' || pathname.startsWith('/applications/');
    (isLending ? lending : insurance).emit('request', request, response);
  });
  server.once('close', () => {
    insurance.emit('close');
    lending.emit('close');
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = createAppServer({ databasePath: process.env.INSURANCE_DB ?? '.insurance.sqlite' });
  server.on('error', (error) => {
    console.error(`Unable to start on port ${port}: ${error.message}`);
    server.emit('close');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Insurance: http://127.0.0.1:${port}/`);
    console.log(`Lending: http://127.0.0.1:${port}/lending/`);
  });
}
