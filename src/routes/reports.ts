import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import multer, { FileFilterCallback } from 'multer';
import * as jwt from 'jsonwebtoken';
import { ReportStore, Report } from '../models/report';
import { requireAuth, requireRole, JWT_SECRET } from '../middleware/auth';

const router = express.Router();
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/pdf',
  'text/plain'
];

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  }
});

const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
const NewReportSchema = z.object({
  title: z.string().min(1, { message: 'Title is required' }),
  description: z.string().min(1, { message: 'Description is required' }),
  severity: SeverityEnum.optional().default('low')
}).strict();
const UpdateReportSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  severity: SeverityEnum.optional()
}).strict();
const BulkReportsSchema = z.array(NewReportSchema);

const severityScoreMap: Record<Report['severity'], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

interface AuditEntry {
  reportId: number;
  userId: string;
  changes: Record<string, [any, any]>;
  timestamp: Date;
}
const auditLogs: AuditEntry[] = [];

/** GET /reports - Get all reports (summary view) */
router.get('/reports', requireAuth, async (req: Request, res: Response) => {
  try {
    const reports = await ReportStore.getAllReports();
    const result = reports.map(report => ({
      id: report.id,
      title: report.title,
      description: report.description,
      severity: report.severity,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      entryCount: report.entryCount,
      severityScore: severityScoreMap[report.severity] || 0
    }));
    return res.json(result);
  } catch (err) {
    console.error('Error fetching reports:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/** GET /reports/:id - Get a report by ID (with optional ?include=entries,attachments) */
router.get('/reports/:id', requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid report ID format' });
  }

  try {
    const report = await ReportStore.getReport(id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const includeParam = (req.query.include as string | undefined) || '';
    const includeParts = includeParam.split(',').map(s => s.trim()).filter(Boolean);
    const includeEntries = includeParts.includes('entries');
    const includeAttachments = includeParts.includes('attachments');

    const entryCount = report.entries.length;
    const severityScore = severityScoreMap[report.severity] || 0;

    if (includeEntries || includeAttachments) {
      let entries = [...report.entries];
      const sortOrder = req.query.order === 'asc' ? 'asc' : 'desc';

      entries.sort((a, b) =>
        sortOrder === 'asc'
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime()
      );

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

      const response: any = {
        id: report.id,
        title: report.title,
        description: report.description,
        severity: report.severity,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
        entryCount,
        severityScore
      };

      if (includeEntries) response.entries = entries;
      if (includeAttachments) {
        response.attachments = report.attachments.map(att => ({
          filename: att.filename,
          originalName: att.originalName,
          mimetype: att.mimetype,
          size: att.size,
          uploadedAt: att.uploadedAt
        }));
      }

      return res.json(response);
    }

    return res.json({
      id: report.id,
      title: report.title,
      description: report.description,
      severity: report.severity,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      entryCount,
      severityScore
    });
  } catch (err) {
    console.error('Error fetching report:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/** POST /reports - Create a new report */
router.post('/reports', requireAuth, async (req: Request, res: Response) => {
  const result = NewReportSchema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.errors ?? result.error.issues;
    return res.status(400).json({ error: 'Invalid request data', details: errors });
  }
  const data = result.data;

  try {
    if (await ReportStore.titleExists(data.title)) {
      return res.status(409).json({ error: 'A report with this title already exists' });
    }

    const newReport = await ReportStore.addReport({
      title: data.title,
      description: data.description,
      severity: data.severity
    });

    console.log(`Report #${newReport.id} created by user ${req.user?.id} (role: ${req.user?.role})`);

    (async function enqueueNewReport(report: Report) {
      try {
        await new Promise(resolve => setTimeout(resolve, 0));
        console.log(`Background log: New report ${report.id} ("${report.title}") enqueued for processing`);
      } catch (err) {
        console.error('Failed to log new report to queue:', err);
      }
    })(newReport);

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
  } catch (err) {
    console.error('Error creating report:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/** PUT /reports/:id - Update a report (full or partial) */
router.put('/reports/:id', requireAuth, async (req: Request, res: Response) => {
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

  try {
    const report = await ReportStore.getReport(id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (updates.title && await ReportStore.titleExists(updates.title, id)) {
      return res.status(409).json({ error: 'Another report with this title already exists' });
    }

    if (updates.severity === 'critical' && req.user && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can escalate severity to critical' });
    }

    const changes: Record<string, [any, any]> = {};
    if (updates.title !== undefined && updates.title !== report.title) changes.title = [report.title, updates.title];
    if (updates.description !== undefined && updates.description !== report.description) changes.description = [report.description, updates.description];
    if (updates.severity !== undefined && updates.severity !== report.severity) changes.severity = [report.severity, updates.severity];

    if (Object.keys(changes).length === 0) {
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

    const updated = await ReportStore.updateReport(id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Report not found' });
    }

    auditLogs.push({
      reportId: id,
      userId: req.user ? req.user.id : 'unknown',
      changes,
      timestamp: new Date()
    });
    console.log(`Audit log [${(req as any).requestId}]: user ${req.user?.id} updated report #${id}`, changes);

    const location = `${req.protocol}://${req.get('host')}/reports/${id}`;
    res.location(location);

    return res.json({
      id: updated.id,
      title: updated.title,
      description: updated.description,
      severity: updated.severity,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      entryCount: report.entries.length,
      severityScore: severityScoreMap[updated.severity] || 0
    });
  } catch (err) {
    console.error('Error updating report:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/** POST /reports/:id/attachment - Upload a file attachment */
router.post('/reports/:id/attachment', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Invalid report ID format' });
  }

  try {
    const report = await ReportStore.getReport(id);
    if (!report) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Report not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded or file type not allowed' });
    }

    const attachment = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date()
    };

    await ReportStore.addAttachment(id, attachment);
    console.log(`Attachment uploaded for report #${id} by user ${req.user?.id}: ${attachment.originalName} (${attachment.size} bytes)`);

    const token = jwt.sign({ reportId: id, file: attachment.filename }, JWT_SECRET, { expiresIn: '15m' });
    const downloadUrl = `${req.protocol}://${req.get('host')}/reports/${id}/attachment/${attachment.filename}?token=${encodeURIComponent(token)}`;
    return res.status(200).json({ downloadUrl });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('Error uploading attachment:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/** POST /reports/:id/entries - Add an entry (comment) to a report */
router.post('/reports/:id/entries', requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid report ID format' });
  }

  const { comment } = req.body;
  if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
    return res.status(400).json({ error: 'Comment is required' });
  }

  try {
    const report = await ReportStore.getReport(id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const entry = await ReportStore.addEntry(id, {
      author: req.user?.id || 'unknown',
      comment
    });

    if (!entry) {
      return res.status(500).json({ error: 'Failed to create entry' });
    }

    return res.status(201).json(entry);
  } catch (err) {
    console.error('Error creating entry:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/** GET /reports/:id/attachment/:filename - Download an attachment using token */
router.get('/reports/:id/attachment/:filename', async (req: Request, res: Response, next: NextFunction) => {
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

  try {
    const report = await ReportStore.getReport(id);
    const attachment = report?.attachments.find(att => att.filename === filename);
    if (!report || !attachment) {
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.resolve('uploads', filename);
    res.setHeader('Content-Type', attachment.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);
    res.sendFile(filePath, err => {
      if (err) {
        console.error('Error sending file:', err);
        return next(err);
      }
    });
  } catch (err) {
    console.error('Error serving attachment:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/** DELETE /reports/:id - Delete a report (admin only) */
router.delete('/reports/:id', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid report ID format' });
  }

  try {
    const deleted = await ReportStore.deleteReport(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Report not found' });
    }
    return res.status(200).json({ message: `Report ${id} deleted successfully` });
  } catch (err) {
    console.error('Error deleting report:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/** POST /reports/bulk - Create multiple reports at once */
router.post('/reports/bulk', requireAuth, async (req: Request, res: Response) => {
  const result = BulkReportsSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid request format', details: result.error.errors });
  }

  const reportsData = result.data;
  const createdReports: any[] = [];
  const failedReports: any[] = [];

  try {
    for (let i = 0; i < reportsData.length; i++) {
      const data = reportsData[i];

      if (await ReportStore.titleExists(data.title)) {
        failedReports.push({ index: i, title: data.title, reason: 'Duplicate title' });
        continue;
      }

      const newReport = await ReportStore.addReport({
        title: data.title,
        description: data.description,
        severity: data.severity
      });

      createdReports.push({
        id: newReport.id,
        title: newReport.title,
        severity: newReport.severity,
        entryCount: 0,
        severityScore: severityScoreMap[newReport.severity]
      });
    }

    return res.status(201).json({
      createdCount: createdReports.length,
      failedCount: failedReports.length,
      createdReports,
      failedReports
    });
  } catch (err) {
    console.error('Error bulk creating reports:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
