import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { routes } from './routes.js';
import { JiraError } from './jira/client.js';

const app = express();

app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '1mb' }));
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

app.listen(config.port, () => {
  console.log(`jira-tool backend on http://localhost:${config.port}`);
  console.log(`  Jira site : ${config.jira.site}`);
  console.log(`  Account   : ${config.jira.email}`);
  console.log(`  CORS      : ${config.corsOrigins.join(', ')}`);
});
