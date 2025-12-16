# Bug Tracker API – Design Document

## 1. Domain & Assumptions

### 1.1 What is a Report?

A **Report** represents a bug/incident raised by a user or developer.

- Core fields:
  - `title`: short human-readable summary of the bug.
  - `description`: detailed description of the issue.
  - `severity`: one of `low | medium | high | critical`.
  - `createdAt`, `updatedAt`: server-side timestamps.
- Nested collections:
  - `entries`: comments / work log updates on the report.
  - `attachments`: uploaded files (logs, screenshots, etc.).

This matches typical bug trackers and provides enough structure to demonstrate nested collections, computed fields, and file attachments.

### 1.2 Severity Model

- Severity is an enum: `low`, `medium`, `high`, `critical`.
- A derived numeric score `severityScore` is used for computed metrics:
  - `low = 1`, `medium = 2`, `high = 3`, `critical = 4`.
- This makes it easy to sort, aggregate, and compare reports by severity.

### 1.3 Entries (Comments)

- `Entry` is a child resource of a Report, representing a comment or work log item:
  - `id`: integer, unique per report.
  - `author`: user id (from JWT).
  - `comment`: textual note.
  - `createdAt`: timestamp.
- Entries are stored in `report.entries` and:
  - Can be **sorted** by `createdAt`.
  - Can be **paginated** (`page`, `pageSize`) via `GET /reports/:id?include=entries&page=…`.

### 1.4 Attachments

- `Attachment` is a child resource representing a file tied to a report:
  - `filename`: internal server filename (opaque ID).
  - `originalName`: original filename uploaded by the client.
  - `mimetype`: content type.
  - `size`: size in bytes.
  - `uploadedAt`: timestamp.
- Attachments are stored on disk (in `uploads/`) for the demo, but exposed via metadata and **signed download URLs**, not raw paths.

### 1.5 Roles & Users

- Two roles are supported:
  - `admin`: full access, can perform all actions, including deletions and severity escalation to `critical`.
  - `developer`: can create and update reports, but **cannot** escalate severity to `critical` and cannot delete reports.
- JWT payload contains:
  - `id`: application-level user identifier.
  - `role`: `"admin"` or `"developer"`.

### 1.6 Storage

- For the challenge, an in-memory `ReportStore` is used:
  - Backed by a static array with an auto-incrementing `nextId`.
  - In a real system, this would be replaced with a database / NoSQL store.
- The API/service layer is designed to be **stateless**, and all state is abstracted behind `ReportStore`.

---

## 2. Schema & Data Model

### 2.1 Report

```ts
type Severity = 'low' | 'medium' | 'high' | 'critical';

interface Attachment {
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  uploadedAt: Date;
}

interface Entry {
  id: number;
  author: string;
  comment: string;
  createdAt: Date;
}

interface Report {
  id: number;
  title: string;
  description: string;
  severity: Severity;
  createdAt: Date;
  updatedAt: Date;
  entries: Entry[];
  attachments: Attachment[];
}
```

### 2.2 Required vs Optional Fields

**Report – required fields (on create):**

*   `title` (string, non-empty)
    
*   `description` (string, non-empty)
    

**Report – optional fields (on create):**

*   `severity` (enum) – defaults to `low` if omitted.
    

**Report – server-generated fields:**

*   `id`
    
*   `createdAt`
    
*   `updatedAt`
    
*   `entries` (defaults to `[]`)
    
*   `attachments` (defaults to `[]`)
    
*   Computed fields in responses:
    
    *   `entryCount` (number of entries)
        
    *   `severityScore` (1–4, derived from severity)
        

**Entry – required fields (on create):**

*   `comment` (string, non-empty)
    

**Entry – server/generated fields:**

*   `id` (per report)
    
*   `author` (from `req.user.id`)
    
*   `createdAt`
    

**Attachment – required (from upload):**

*   File content under form field `file`.
    

**Attachment – server/generated fields:**

*   `filename` (opaque ID from Multer)
    
*   `originalName`, `mimetype`, `size` (from upload)
    
*   `uploadedAt`
    

* * *

## 3\. Authentication & Authorization Model

### 3.1 Authentication

*   JWT-based auth using `Authorization: Bearer <token>`.
    
*   Token is issued by `POST /auth/login` with a simple payload `{ id, role }`.
    
*   `JWT_SECRET` is configured via environment variable; tokens expire after 1 hour.
    

### 3.2 Roles & Permissions

**Roles:**

*   `admin`
    
*   `developer`
    

**Permissions:**

*   **Both admin and developer can:**
    
    *   `POST /reports` – create new reports.
        
    *   `GET /reports/:id` – read a specific report.
        
    *   `GET /reports` – list reports (summary view).
        
    *   `PUT /reports/:id` – update non-critical fields and non-critical severities.
        
    *   `POST /reports/:id/entries` – add entries (comments).
        
    *   `POST /reports/:id/attachment` – upload attachment for an existing report.
        
    *   `GET /reports/:id/attachment/:filename?token=...` – download attachment via signed URL (no Authorization header required; token-based).
        
*   **Admin-only actions:**
    
    *   `DELETE /reports/:id` – delete a report.
        
    *   Escalate severity to `critical` (custom business rule).
        
    *   Bulk admin operations (e.g., deleting sensitive reports).
        

### 3.3 Custom Business Rule

**Rule:**

> Only `admin` users may change a report’s severity to `critical`.

**Enforcement (PUT /reports/:id):**

`if (updates.severity === 'critical' && req.user && req.user.role !== 'admin') {   return res.status(403).json({ error: 'Only admins can escalate severity to critical' }); }`

**Impact:**

*   **Validation:** `severity` is still validated via Zod as an enum, but authorization rejects invalid role/severity combinations.
    
*   **API behavior:**
    
    *   Developer sending `{ "severity": "critical" }` receives `403 Forbidden` with an explanatory message.
        
    *   Admin is allowed; changes are persisted and audited.
        
*   **Data modeling:**
    
    *   No schema changes required; `severity` remains a field on `Report`.
        
    *   In a real system, we could extend the model with `escalatedBy` and `escalatedAt` for extra traceability.
        

* * *

## 4\. Concurrency & Idempotency

### 4.1 PUT Idempotency

`PUT /reports/:id` supports both **full** and **partial** updates:

*   All fields in `UpdateReportSchema` are optional.
    
*   Only provided fields are applied; others remain unchanged.
    

To maintain idempotent behavior:

*   If the incoming payload does not change any fields (title, description, severity), the server:
    
    *   Does **not** create a new audit log entry.
        
    *   Returns the current representation of the report with `200 OK`.
        

Thus, repeated PUTs with the same body are **safe and idempotent** in terms of resulting resource state.

### 4.2 Concurrency Control (Not Fully Implemented)

*   Optimistic concurrency control (e.g., ETag / `If-Match` headers, or a `version` field) is **not implemented** in this demo.
    
*   In a production system:
    
    *   Each report would have a `version` or a monotonically-increasing `updatedAt`.
        
    *   Clients would send `If-Match: <version>` or `If-Unmodified-Since`.
        
    *   The server would return `412 Precondition Failed` on conflicting concurrent updates.
        

The current design keeps the door open to add these mechanisms without changing API signatures.

* * *

## 5\. File Storage & Access Security

### 5.1 Upload

*   Endpoint: `POST /reports/:id/attachment`
    
*   Auth: `requireAuth` (JWT Bearer).
    
*   Body: `multipart/form-data` with `file` field:
    
    *   Uses Multer with:
        
        *   `dest: 'uploads/'`
            
        *   `limits.fileSize = 5MB` (example value)
            
        *   `fileFilter` to allow only specific mime types (e.g. PNG/JPEG/PDF/text).
            
*   If the report does not exist:
    
    *   Any uploaded file is deleted.
        
    *   Returns `404 Report not found`.
        
*   If no file was accepted (missing or disallowed type/size):
    
    *   Returns `400` with an error message.
        

### 5.2 Storage Abstraction

*   Files are stored on the local filesystem under `uploads/`.
    
*   The application stores **metadata only** (filename, originalName, mimetype, size, uploadedAt) in the `Report.attachments` array.
    
*   The rest of the system interacts only with this metadata; it does not embed filesystem paths in responses.
    

In production, the same pattern can be reused with an object storage backend (e.g., S3/GCS) by swapping the underlying storage logic but keeping the attachment metadata structure.

### 5.3 Safe Download with Signed URLs

*   Upload endpoint returns a **signed download URL**:
    
    *   `GET /reports/:id/attachment/:filename?token=<jwt>`
        
*   Download URL token is a JWT containing:
    
    *   `reportId`
        
    *   `file` (internal filename)
        
*   Token is signed with `JWT_SECRET` and expires after **15 minutes**.
    

**Download rules:**

*   No `Authorization` header is required; access is controlled entirely by the `token` query parameter.
    
*   Download endpoint:
    
    *   Verifies the JWT signature and expiry.
        
    *   Confirms `reportId` and `file` in the token match the path params.
        
    *   Confirms the report and attachment exist.
        
    *   Streams the file with appropriate `Content-Type` and `Content-Disposition`.
        

**Who may use download links?**

*   Anyone in possession of the signed URL while it is valid.
    
*   In practice:
    
    *   Only authenticated clients that upload or fetch the link would see the URL.
        
    *   Because the link is time-limited and bound to a specific report/file, the blast radius of leakage is minimized.
        

### 5.4 Virus/Malware Scanning (Future)

Not implemented in code, but the design anticipates:

*   Initially store uploaded files as “untrusted” and mark attachments as `scanStatus: 'pending'`.
    
*   Enqueue a scan job to a malware scanning service (e.g., ClamAV, SaaS AV).
    
*   Only allow download (or signed URL issuance) if `scanStatus === 'clean'`.
    
*   If `scanStatus === 'infected'`, delete/quarantine the file and mark the attachment accordingly.
    
*   Use retries and dead-letter queues for scan failures.
    

* * *

## 6\. Asynchronous Side Effects

### 6.1 Current Implementation

On `POST /reports`, after successfully creating a report:

*   The service triggers an asynchronous “enqueue” task:
    
    ``(async function enqueueNewReport(report: Report) {
    try {
         await new Promise(resolve => setTimeout(resolve, 0));
         console.log(`Background log: New report ${report.id} ("${report.title}") enqueued for processing`);
       }
    catch (err) {
         console.error('Failed to log new report to queue:', err);
       }
     })(newReport);``
    
*   This simulates enqueuing a message to a background system (e.g., notifications, analytics, search indexing).
    

### 6.2 Failure Handling Strategy

*   Failures in this async path are caught and logged.
    
*   They do **not** affect the success of the primary operation (report creation), which already returned `201 Created`.
    
*   In a production deployment, this would be replaced with a real message queue (e.g., SQS, Kafka, Pub/Sub) with:
    
    *   Built-in retry policies.
        
    *   Dead-letter queue (DLQ) for messages that repeatedly fail.
        
    *   Metrics and alerts for monitoring failures.
        

* * *

## 7\. Code Quality Practices

### 7.1 Modularity & Naming

*   Separation of concerns:
    
    *   `index.ts` – application bootstrap, middleware, routes mounting, global error handling.
        
    *   `routes/reports.ts` – all Report-related endpoints and business rules.
        
    *   `routes/auth.ts` – Login/auth endpoints.
        
    *   `middleware/auth.ts` – JWT parsing and role-based authorization (`requireAuth`, `requireRole`).
        
    *   `models/report.ts` – data model and in-memory `ReportStore`.
        
*   Function and variable names are descriptive (`requireAuth`, `severityScoreMap`, `addAttachment`, `deleteReport`, etc.).
    
*   Dead/commented-out code is avoided; legacy helpers are removed once replaced.
    

### 7.2 Type Safety & Validation

*   The codebase is written in **TypeScript** with explicit type annotations for:
    
    *   Route handlers (`Request`, `Response`, `NextFunction`).
        
    *   Models (`Report`, `Entry`, `Attachment`).
        
*   **Zod** schemas provide runtime validation for JSON request bodies:
    
    *   `NewReportSchema` for creation.
        
    *   `UpdateReportSchema` for updates.
        
*   This combination ensures both compile-time and runtime safety.
    

### 7.3 Error Handling & Schema

*   Centralized Express error handler:
    
    *   Catches malformed JSON (returns `400 Bad JSON format`).
        
    *   Catches Multer errors (e.g., `LIMIT_FILE_SIZE`).
        
    *   Handles unexpected errors uniformly as `500 Internal Server Error`.
        
*   Validation failures return structured JSON with:
    
    *   `error` message.
        
    *   `details` from Zod’s issue list (field-level error information).
        

### 7.4 Linters, Static Analysis, Testing Philosophy

*   Linting & formatting:
    
    *   Intended: ESLint + Prettier configuration for consistent style and basic static checks.
        
*   Static analysis:
    
    *   TypeScript compiler acts as the primary static analysis tool.
        
    *   In CI, the project would run `tsc --noEmit` and linting.
        
*   Testing philosophy (to be implemented in a full project):
    
    *   Unit tests: `ReportStore`, auth middleware, business rules (e.g., severity escalation).
        
    *   Integration tests: HTTP-level tests using Jest + Supertest for each endpoint (create, update, delete, upload, download).
        
    *   End-to-end smoke tests: create report → add entry → upload attachment → fetch GET with `include=entries,attachments`.
        

* * *

## 8\. Scaling & Observability

### 8.1 Horizontal Scaling

*   The API layer is stateless:
    
    *   All persistent data is behind `ReportStore`.
        
    *   In production, `ReportStore` would use a shared DB (SQL/NoSQL), enabling multiple API instances.
        
*   Files are stored on a file system for the demo:
    
    *   In production, this would be moved to a shared object store (e.g., S3/GCS), making the service horizontally scalable.
        

### 8.2 Data Access & Pagination

*   Nested entries are paginated using `page` and `pageSize` query params.
    
    `GET /reports/:id?include=entries&page=1&pageSize=10&order=desc`
    
*   The collection-level endpoint `GET /reports` returns summaries; in a production system, it would also support pagination and filters (e.g., severity, date range) with DB indexes on key fields.
    

### 8.3 Observability & Logging

*   Request ID middleware:
    
    *   Each incoming request gets a `requestId` generated via `randomUUID()`.
        
    *   The ID is attached to the request (`req.requestId`) and set in response header `X-Request-Id`.
        
*   Structured access logging:
    
    *   Each request logs a JSON line with `level`, `msg`, `requestId`, `method`, `path`.
        
*   Audit logging:
    
    *   PUT /reports/:id logs meaningful audit entries (who changed what and when) with the `requestId` included in the log line.
        
*   These logs can be ingested into centralized logging systems (ELK/Datadog) and correlated across services using `requestId`.
    

* * *

## 9\. Evolving Spec & Extensibility

### 9.1 New Computed Metrics

*   Existing computed fields (`entryCount`, `severityScore`) live in the GET `/reports/:id` representation layer.
    
*   New metrics (e.g., `attachmentCount`, `lastActivityAt`, `status: active|stale`) can be added without touching the storage schema.
    

### 9.2 Expansion Semantics

*   `?include=entries,attachments` controls nested expansions.
    
*   Adding more includes (e.g., `?include=entries,attachments,metrics,audit`) is straightforward:
    
    *   Parse `include` tokens.
        
    *   Conditionally attach sections in the response.
        

### 9.3 Additional Views

*   Current views:
    
    *   Summary view: `GET /reports/:id`
        
    *   Expanded view: `GET /reports/:id?include=entries,attachments`
        
    *   List view: `GET /reports`
        
*   New views can be added as separate endpoints (`/reports/statistics`, `/reports/:id/audit`) or via additional query parameters without breaking existing clients.
    

### 9.4 Storage & Infra Swaps

*   The abstraction around `ReportStore` and attachment metadata allows swapping:
    
    *   In-memory → database.
        
    *   Local disk → object storage.
        
*   The external API shape remains stable, minimizing rework.
    

* * *

## 10\. Required Payloads for Business Logic

### 10.1 Create Report (POST /reports)

`{   "title": "Payment page crashes on submit",
"description": "Submitting the payment form throws a TypeError on Chrome.",
"severity": "high" }`

*   Required: `title`, `description`
    
*   Optional: `severity` (defaults to `low` if omitted)
    

### 10.2 Update Report (PUT /reports/:id)

Partial update by developer:

`{   "description": "Updated steps to reproduce and environment details." }`

Admin escalating severity to critical (custom business rule):

`{   "severity": "critical" }`

*   If sent by `developer` role → `403 Forbidden`.
    
*   If sent by `admin` → success and audited.
    

### 10.3 Add Entry (POST /reports/:id/entries)

`{   "comment": "Reproduced on Chrome 120. Investigating root cause." }`

*   Required: `comment`
    

### 10.4 Upload Attachment (POST /reports/:id/attachment)

*   Request type: `multipart/form-data`
    
*   Field:
    
    | Key | Type | Value |
    | --- | --- | --- |
    | file | File | choose a file |
    
*   Example: screenshot or log file.
    

### 10.5 Download Attachment (GET /reports/:id/attachment/:filename)

*   First, call upload endpoint and capture:
    
    `{   "downloadUrl": "http://localhost:3000/reports/1/attachment/8ef3727c800e686c892be9e09c5da022?token=eyJhbGciOi..." }`
    
*   Then, call:
    
    `GET /reports/1/attachment/8ef3727c800e686c892be9e09c5da022?token=eyJhbGciOi...`
    
*   No `Authorization` header is required; the `token` query param controls access.
    

* * *

## 11\. Optional Extensions / Next Steps

*   Replace in-memory `ReportStore` with a real database (Postgres, Mongo, etc.).
    
*   Introduce optimistic concurrency using `version` or `ETag` + `If-Match`.
    
*   Add `GET /reports/:id/audit` to retrieve change history and surface the audit log.
    
*   Introduce additional roles (e.g., `viewer`, `qa`) with finer-grained permissions.
    
*   Plug in a real queue for async jobs and a real AV scanner for attachments.
    
*   Add automated tests (unit + integration) and CI/CD pipeline with lint/typecheck/test stages.
