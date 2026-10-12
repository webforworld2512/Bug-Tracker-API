import express from 'express';
import 'dotenv/config';
import multer from 'multer';
import { randomUUID } from 'crypto';
import reportsRouter from '../src/routes/reports';
import authRouter from '../src/routes/auth';

const app = express();

app.use(express.json());
app.use('/', reportsRouter);
app.use('/', authRouter);

app.get('/', (_req, res) => {
  res.send('Bug Tracker API is running');
});

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Bad JSON format' });
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    console.error('Unexpected error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.use((req, res, next) => {
  const requestId = randomUUID();
  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

export default app;
