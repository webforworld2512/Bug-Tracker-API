import { supabase } from '../db/supabase';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Entry {
  id: number;
  author: string;
  comment: string;
  createdAt: Date;
}

export interface Attachment {
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  uploadedAt: Date;
}

export interface Report {
  id: number;
  title: string;
  description: string;
  severity: Severity;
  createdAt: Date;
  updatedAt: Date;
  entries: Entry[];
  attachments: Attachment[];
}

export interface ReportSummary {
  id: number;
  title: string;
  description: string;
  severity: Severity;
  createdAt: Date;
  updatedAt: Date;
  entryCount: number;
}

// --- DB row shapes (snake_case from Postgres) ---

interface ReportRow {
  id: number;
  title: string;
  description: string;
  severity: Severity;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: number;
  report_id: number;
  author: string;
  comment: string;
  created_at: string;
}

interface AttachmentRow {
  id: number;
  report_id: number;
  filename: string;
  original_name: string;
  mimetype: string;
  size: number;
  uploaded_at: string;
}

function mapReport(row: ReportRow, entries: EntryRow[] = [], attachments: AttachmentRow[] = []): Report {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    entries: entries.map(e => ({
      id: e.id,
      author: e.author,
      comment: e.comment,
      createdAt: new Date(e.created_at)
    })),
    attachments: attachments.map(a => ({
      filename: a.filename,
      originalName: a.original_name,
      mimetype: a.mimetype,
      size: a.size,
      uploadedAt: new Date(a.uploaded_at)
    }))
  };
}

export class ReportStore {
  static async getReport(id: number): Promise<Report | null> {
    const { data: row, error } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !row) return null;

    const [{ data: entries }, { data: attachments }] = await Promise.all([
      supabase.from('entries').select('*').eq('report_id', id).order('created_at', { ascending: true }),
      supabase.from('attachments').select('*').eq('report_id', id)
    ]);

    return mapReport(row as ReportRow, (entries || []) as EntryRow[], (attachments || []) as AttachmentRow[]);
  }

  static async getAllReports(): Promise<ReportSummary[]> {
    const { data: rows, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !rows || rows.length === 0) return [];

    const reportIds = (rows as ReportRow[]).map(r => r.id);
    const { data: entryRows } = await supabase
      .from('entries')
      .select('report_id')
      .in('report_id', reportIds);

    const countMap: Record<number, number> = {};
    (entryRows || []).forEach((e: { report_id: number }) => {
      countMap[e.report_id] = (countMap[e.report_id] || 0) + 1;
    });

    return (rows as ReportRow[]).map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      entryCount: countMap[row.id] || 0
    }));
  }

  static async titleExists(title: string, excludeId?: number): Promise<boolean> {
    let query = supabase
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .ilike('title', title);

    if (excludeId !== undefined) {
      query = query.neq('id', excludeId);
    }

    const { count } = await query;
    return (count ?? 0) > 0;
  }

  static async addReport(data: { title: string; description: string; severity: Severity }): Promise<Report> {
    const { data: row, error } = await supabase
      .from('reports')
      .insert({ title: data.title, description: data.description, severity: data.severity })
      .select()
      .single();

    if (error || !row) throw new Error(error?.message ?? 'Failed to create report');
    return mapReport(row as ReportRow);
  }

  static async updateReport(
    id: number,
    updates: Partial<{ title: string; description: string; severity: Severity }>
  ): Promise<Report | null> {
    const { data: row, error } = await supabase
      .from('reports')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !row) return null;
    return mapReport(row as ReportRow);
  }

  static async addEntry(reportId: number, entry: { author: string; comment: string }): Promise<Entry | null> {
    // Touch the report's updated_at (trigger will set it to NOW())
    await supabase.from('reports').update({ updated_at: new Date().toISOString() }).eq('id', reportId);

    const { data: row, error } = await supabase
      .from('entries')
      .insert({ report_id: reportId, author: entry.author, comment: entry.comment })
      .select()
      .single();

    if (error || !row) return null;
    const e = row as EntryRow;
    return { id: e.id, author: e.author, comment: e.comment, createdAt: new Date(e.created_at) };
  }

  static async addAttachment(reportId: number, attachment: Attachment): Promise<Attachment | null> {
    // Touch the report's updated_at
    await supabase.from('reports').update({ updated_at: new Date().toISOString() }).eq('id', reportId);

    const { data: row, error } = await supabase
      .from('attachments')
      .insert({
        report_id: reportId,
        filename: attachment.filename,
        original_name: attachment.originalName,
        mimetype: attachment.mimetype,
        size: attachment.size,
        uploaded_at: attachment.uploadedAt.toISOString()
      })
      .select()
      .single();

    if (error || !row) return null;
    const a = row as AttachmentRow;
    return {
      filename: a.filename,
      originalName: a.original_name,
      mimetype: a.mimetype,
      size: a.size,
      uploadedAt: new Date(a.uploaded_at)
    };
  }

  static async deleteReport(id: number): Promise<boolean> {
    const { data, error } = await supabase
      .from('reports')
      .delete()
      .eq('id', id)
      .select('id');

    return !error && (data?.length ?? 0) > 0;
  }
}
