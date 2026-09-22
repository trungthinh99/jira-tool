import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { routes } from './routes.js';
import { JiraError } from './jira/client.js';

const app = express();

app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '1mb' }));

/**
 * Log every write.
 *
 * Posting a report and pinging Slack both leave marks other people see, and a
 * duplicate is impossible to diagnose after the fact without knowing how many
 * requests actually arrived. Reads are left alone — they are noise.
 */
app.use('/api', (req, _res, next) => {
  if (req.method !== 'GET') {
    console.log(`[${new Date().toISOString()}] ${req.method} /api${req.url}`);
  }
  next();
});

app.use('/api', routes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof JiraError) {
    console.error(`[jira ${error.status}] ${error.message}`);
    // 401/403 from Jira means our token, not the caller's request — report it
    // as a gateway failure so the UI does not tell the user to sign in again.
    const status = error.status === 401 || error.status === 403 ? 502 : error.status;
    res.status(status).json({ error: error.message });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected error.';
  console.error('[error]', message);
  res.status(500).json({ error: message });
});

const server = app.listen(config.port, () => {
  console.log(`jira-tool backend on http://localhost:${config.port}`);
  console.log(`  Jira site : ${config.jira.site}`);
  console.log(`  Account   : ${config.jira.email}`);
  console.log(`  CORS      : ${config.corsOrigins.join(', ')}`);
});

/**
 * Release port 4180 before the process exits.
 *
 * `tsx watch` restarts by signalling this process and starting a new one. On
 * Windows the old process can still be holding the listening socket when the
 * new one calls listen(), which crashes it with EADDRINUSE — the server is then
 * simply gone, which reads as "my new endpoint doesn't work" rather than as a
 * crash. Closing on the signal makes a reload-on-save actually survive.
 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGUSR2'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    // Don't let a lingering keep-alive connection hold the port open.
    server.closeAllConnections?.();
  });
}

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${config.port} đang bị chiếm. Còn một backend cũ chạy nền — đóng nó rồi thử lại.`,
    );
    process.exit(1);
  }
  throw error;
});
