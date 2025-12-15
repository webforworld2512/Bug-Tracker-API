import express, { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { JWT_SECRET, AuthPayload } from '../middleware/auth';

const router = express.Router();

/**
 * Very simple fake login:
 * POST /auth/login
 * body: { "id": "someuser", "role": "admin" | "developer" }
 */
router.post('/auth/login', (req: Request, res: Response) => {
  const { id, role } = req.body;

  if (!id || (role !== 'admin' && role !== 'developer')) {
    return res.status(400).json({ error: 'id and role are required' });
  }

  const payload: AuthPayload = { id, role };

  // Create JWT with 1 hour expiry
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

  return res.json({ token });
});

export default router;
