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

/**
 * In-memory data store for reports.
 * (In a real app, this would interface with a database.)
 */
export class ReportStore {
    private static reports: Report[] = [];
    private static nextId: number = 1;

    /** Retrieve a report by ID */
    static getReport(id: number): Report | undefined {
        return this.reports.find(report => report.id === id);
    }

    /** Return all reports */
    static getAllReports(): Report[] {
        return this.reports;
    }

    /** Check if a title already exists (optionally excluding a given report ID) - business invariant */
    static titleExists(title: string, excludeId?: number): boolean {
        return this.reports.some(report =>
            report.title.toLowerCase() === title.toLowerCase() && (excludeId ? report.id !== excludeId : true)
        );
    }

    /** Create a new report and add it to the store */
    static addReport(data: { title: string; description: string; severity: Severity }): Report {
        const now = new Date();
        const newReport: Report = {
            id: this.nextId++,
            title: data.title,
            description: data.description,
            severity: data.severity,
            createdAt: now,
            updatedAt: now,
            entries: [],
            attachments: []
        };
        this.reports.push(newReport);
        return newReport;
    }

    /** Update an existing report with given fields */
    static updateReport(id: number, updates: Partial<{ title: string; description: string; severity: Severity }>): Report | undefined {
        const report = this.getReport(id);
        if (!report) return undefined;
        if (updates.title !== undefined) {
            report.title = updates.title;
        }
        if (updates.description !== undefined) {
            report.description = updates.description;
        }
        if (updates.severity !== undefined) {
            report.severity = updates.severity;
        }
        report.updatedAt = new Date();
        return report;
    }

    /** Add an attachment record to a report */
    static addAttachment(reportId: number, attachment: Attachment): Attachment | undefined {
        const report = this.getReport(reportId);
        if (!report) return undefined;
        report.attachments.push(attachment);
        report.updatedAt = new Date();
        return attachment;
    }

    /** Delete a report by ID. Returns true if deleted, false if not found. */
    static deleteReport(id: number): boolean {
    const index = this.reports.findIndex(report => report.id === id);
    if (index === -1) return false;

    this.reports.splice(index, 1);
    return true;
  }
}