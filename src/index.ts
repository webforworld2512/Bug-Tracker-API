import express from 'express';
import 'dotenv/config';
import fs from 'fs';
import multer from 'multer';
import reportsRouter from './routes/reports';
import authRouter from './routes/auth';

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Body parser middleware
app.use(express.json());

// Mount the reports router at root (routes contain their own prefixes)
app.use('/', reportsRouter);
app.use('/', authRouter);

// Basic welcome route (optional)
app.get('/', (req, res) => {
  res.send('Bug Tracker API is running');
});

// Global error handler for any unhandled errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    console.error('Malformed JSON in request:', err.message);
    return res.status(400).json({ error: 'Bad JSON format' });
  }
  if (err instanceof multer.MulterError) {
    // Handle Multer file upload errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    console.error('Unexpected error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});