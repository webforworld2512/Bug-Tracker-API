import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import * as jwt from 'jsonwebtoken';
import { ReportStore, Report } from '../models/report';
import { requireAuth, requireRole, JWT_SECRET } from '../middleware/auth';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// Validation schemas for request bodies using Zod
const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
const NewReportSchema = z.object({
  title: z.string().min(1, { message: "Title is required" }),
  description: z.string().min(1, { message: "Description is required" }),
  severity: SeverityEnum.optional().default('low')
}).strict();
const UpdateReportSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  severity: SeverityEnum.optional()
}).strict();

// Compute severity score mapping for output
const severityScoreMap: Record<Report["severity"], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

// Simple in-memory audit log (for demonstration)
interface AuditEntry { 
  reportId: number; 
  userId: string; 
  changes: Record<string, [any, any]>; 
  timestamp: Date;
}
const auditLogs: AuditEntry[] = [];

/** GET /reports/:id - Get a report by ID (with optional ?include=entries) */
router.get('/reports/:id', requireAuth, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid report ID format' });
  }
  const report = ReportStore.getReport(id);
  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }
  const includeEntries = req.query.include === 'entries';

  // Common fields + computed metrics
  const entryCount = report.entries.length;
  const severityScore = severityScoreMap[report.severity] || 0;

  if (includeEntries) {
    // Prepare entries with optional sorting and pagination
    let entries = [...report.entries];
    const sortOrder = req.query.order === 'asc' ? 'asc' : 'desc';
    entries.sort((a, b) => {
      return sortOrder === 'asc'
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : b.createdAt.getTime() - a.createdAt.getTime();
    });
    // Pagination: page & pageSize
    let page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    let pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined;
    if (page && !pageSize) pageSize = 10;
    if (!page && pageSize) page = 1;
    if (page && pageSize) {
      if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
        return res.status(400).json({ error: 'Invalid pagination parameters' });
      }
      const startIndex = (page - 1) * pageSize;
      entries = entries.slice(startIndex, startIndex + pageSize);
    }
    // Return report with entries
    return res.json({
      id: report.id,
      title: report.title,
      description: report.description,
      severity: report.severity,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      entryCount: entryCount,
      severityScore: severityScore,
      entries: entries
    });
  } else {
    // Return flattened summary (no entries array)
    return res.json({
      id: report.id,
      title: report.title,
      description: report.description,
      severity: report.severity,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      entryCount: entryCount,
      severityScore: severityScore
      // no 'entries' field in summary view
    });
  }
});

/** POST /reports - Create a new report */
router.post('/reports', requireAuth, (req: Request, res: Response) => {
  const result = NewReportSchema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.errors ?? result.error.issues;
    return res.status(400).json({ error: 'Invalid request data', details: errors });
  }
  const data = result.data;
  // Uniqueness check for title
  if (ReportStore.titleExists(data.title)) {
    return res.status(409).json({ error: 'A report with this title already exists' });
  }
  // Create report
  const newReport = ReportStore.addReport({
    title: data.title,
    description: data.description,
    severity: data.severity
  });
  console.log(`Report #${newReport.id} created by user ${req.user?.id} (role: ${req.user?.role})`);
  // Asynchronous side effect: log to background queue (simulated)
  (async function enqueueNewReport(report: Report) {
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      console.log(`Background log: New report ${report.id} ("${report.title}") enqueued for processing`);
    } catch (err) {
      console.error('Failed to log new report to queue:', err);
    }
  })(newReport);
  // Respond with created report (summary)
  return res.status(201).json({
    id: newReport.id,
    title: newReport.title,
    description: newReport.description,
    severity: newReport.severity,
    createdAt: newReport.createdAt,
    updatedAt: newReport.updatedAt,
    entryCount: 0,
    severityScore: severityScoreMap[newReport.severity] || 0
  });
});

/** PUT /reports/:id - Update a report (full or partial) */
router.put('/reports/:id', requireAuth, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid report ID format' });
  }
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: 'No update data provided' });
  }
  const result = UpdateReportSchema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.errors ?? result.error.issues;
    return res.status(400).json({ error: 'Invalid update data', details: errors });
  }
  const updates = result.data;
  const report = ReportStore.getReport(id);
  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }
  // Unique title check
  if (updates.title && ReportStore.titleExists(updates.title, id)) {
    return res.status(409).json({ error: 'Another report with this title already exists' });
  }
  // Role-based rule: only admin can set critical severity
  if (updates.severity === 'critical' && req.user && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can escalate severity to critical' });
  }

  const oldReport = { ...report };
  const changes: Record<string, [any, any]> = {};

  // Apply changes and record diffs
  if (updates.title !== undefined && updates.title !== report.title) {
    changes.title = [report.title, updates.title];
    report.title = updates.title;
  }
  if (updates.description !== undefined && updates.description !== report.description) {
    changes.description = [report.description, updates.description];
    report.description = updates.description;
  }
  if (updates.severity !== undefined && updates.severity !== report.severity) {
    changes.severity = [report.severity, updates.severity];
    report.severity = updates.severity;
  }
  if (Object.keys(changes).length > 0) {
    report.updatedAt = new Date();
    auditLogs.push({ reportId: report.id, userId: req.user ? req.user.id : 'unknown', changes: changes, timestamp: new Date() });
    console.log(`Audit log: user ${req.user?.id} updated report #${report.id}`, changes);
  } else {
    // Nothing actually changed
    return res.status(200).json({
      id: report.id,
      title: report.title,
      description: report.description,
      severity: report.severity,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      entryCount: report.entries.length,
      severityScore: severityScoreMap[report.severity] || 0
    });
  }
  // Respond with updated report (summary)
  return res.json({
    id: report.id,
    title: report.title,
    description: report.description,
    severity: report.severity,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    entryCount: report.entries.length,
    severityScore: severityScoreMap[report.severity] || 0
  });
});

/** POST /reports/:id/attachment - Upload a file attachment */
router.post('/reports/:id/attachment', requireAuth, upload.single('file'), (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    // Invalid ID format; cleanup uploaded file if any
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Invalid report ID format' });
  }
  const report = ReportStore.getReport(id);
  if (!report) {
    if (req.file) fs.unlink(req.file.path, () => {}); // remove file if report doesn't exist
    return res.status(404).json({ error: 'Report not found' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // Save attachment metadata
  const attachment = {
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    uploadedAt: new Date()
  };
  ReportStore.addAttachment(id, attachment);
  console.log(`Attachment uploaded for report #${id} by user ${req.user?.id}: ${attachment.originalName} (${attachment.size} bytes)`);
  // Generate signed download URL (JWT token with short expiration)
  const token = jwt.sign({ reportId: id, file: attachment.filename }, JWT_SECRET, { expiresIn: '15m' });
  const downloadUrl = `${req.protocol}://${req.get('host')}/reports/${id}/attachment/${attachment.filename}?token=${encodeURIComponent(token)}`;
  return res.status(200).json({ downloadUrl });
});

/** GET /reports/:id/attachment/:filename - Download an attachment using token */
router.get('/reports/:id/attachment/:filename', (req: Request, res: Response, next: NextFunction) => {
  const id = parseInt(req.params.id, 10);
  const filename = req.params.filename;
  const token = req.query.token as string | undefined;
  if (isNaN(id) || !filename) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { reportId: number; file: string };
    if (decoded.reportId !== id || decoded.file !== filename) {
      console.warn(`Download token payload mismatch (report ${id}, file ${filename})`);
      return res.status(403).json({ error: 'Invalid token for this file' });
    }
  } catch (err) {
    console.warn(`Invalid or expired token for file download: ${err instanceof Error ? err.message : err}`);
    return res.status(401).json({ error: 'Unauthorized or expired token' });
  }
  const report = ReportStore.getReport(id);
  const attachment = report?.attachments.find(att => att.filename === filename);
  if (!report || !attachment) {
    return res.status(404).json({ error: 'File not found' });
  }
  const filePath = path.resolve('uploads', filename);
  // Set headers and send file
  res.setHeader('Content-Type', attachment.mimetype);
  res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);
  res.sendFile(filePath, err => {
    if (err) {
      console.error('Error sending file:', err);
      return next(err);
    }
  });
});

// // Only admins can delete a report, for example
// router.delete('/reports/:id', requireAuth, requireRole('admin'), (req, res) => {
//   // delete logic
// });

// export function requireRole(allowed: 'admin' | 'developer' | Array<'admin' | 'developer'>) {
//   const roles = Array.isArray(allowed) ? allowed : [allowed];

//   return (req: Request, res: Response, next: NextFunction) => {
//     if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
//     if (!roles.includes(req.user.role)) {
//       return res.status(403).json({ error: 'Forbidden' });
//     }
//     next();
//   };
// }

export default router;