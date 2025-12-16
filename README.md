# Bug Tracker Backend API

A small bug-tracking REST API with:

- Reports (bugs)
- Nested entries (comments)
- File attachments
- JWT authentication
- Role-based authorization
- Signed download URLs for attachments

This README assumes you use **Postman** for testing (no curl required).

---

## Tech Stack

- Node.js + Express
- TypeScript
- Zod (validation)
- jsonwebtoken (JWT)
- Multer (file upload)

---

## Setup & Run Instructions

### 1. Clone the repository

1. Download or clone the code.
2. Open the project folder in your editor/terminal.

---

### 2. Install dependencies

```bash
npm install
```

### 3\. Configure environment variables

### 

Create a `.env` file in the project root:

`PORT=3000 JWT_SECRET=super-secret-key-change-me`

**Notes:**

*   `PORT` – optional (defaults to 3000)
    
*   `JWT_SECRET` – required; used to sign JWTs (auth + signed download URLs)
    

* * *

### 4\. Start the server

### 

In dev mode (if using nodemon):

`npm run dev`

or build then run:

`npm run build npm start`

The API will be available at:

`http://localhost:3000`

Test health route in browser or Postman:

**Method:** `GET`  
**URL:** `http://localhost:3000/`  
**Response:** `Bug Tracker API is running`

* * *

# Authentication in Postman

### 

All protected endpoints require a JWT in the **Authorization** header.

* * *

## 1\. Obtain a token using `POST /auth/login`

### 

In Postman:

**Method:** POST  
**URL:** `http://localhost:3000/auth/login`

**Headers:**

`Content-Type: application/json`

**Body (admin example):**

`{   "id": "admin1",   "role": "admin" }`

**Body (developer example):**

`{   "id": "dev1",   "role": "developer" }`

**Response example:**

`{   "token": "<JWT_TOKEN_HERE>" }`

* * *

## 2\. Save tokens as Postman environment variables

### 

1.  Copy the returned token.
    
2.  In Postman → click **Environment Quick Look** (top-right eye icon) → **Edit**.
    
3.  Create these variables:
    

`ADMIN_TOKEN = <your-admin-token> DEV_TOKEN = <your-dev-token>`

4.  Select the environment for your requests.
    

Then, in any request's **Authorization tab**:

`Type: Bearer Token Token: {{ADMIN_TOKEN}}   or   {{DEV_TOKEN}}`

* * *

# API Endpoints & Testing in Postman

### 

For all endpoints below (except `/auth/login` and file download), set:

`Authorization → Bearer Token → {{ADMIN_TOKEN}} or {{DEV_TOKEN}}`

* * *

# 1\. Auth

## POST /auth/login

### 

**URL:** `http://localhost:3000/auth/login`  
**Method:** POST  
**Headers:**

`Content-Type: application/json`

**Body:**

`{   "id": "admin1",   "role": "admin" }`

Use the returned token as `ADMIN_TOKEN` or `DEV_TOKEN`.

* * *

# 2\. Reports

### 

* * *

## POST /reports — Create a report

### 

**Method:** POST  
**URL:** `http://localhost:3000/reports`  
**Authorization:** `{{DEV_TOKEN}}` or `{{ADMIN_TOKEN}}`

**Headers:**

`Content-Type: application/json`

**Body:**

`{   "title": "Payment page crashes on submit",   "description": "Submitting the payment form throws a TypeError on Chrome.",   "severity": "high" }`

* * *

## GET /reports — List all reports

### 

**URL:** `http://localhost:3000/reports`  
Returns summary view (no entries or attachments).

* * *

## GET /reports/:id — Single report summary

### 

Example:

`GET http://localhost:3000/reports/1`

**Sample Response:**

`{   "id": 1,   "title": "Payment page crashes on submit",   "description": "Submitting the payment form throws a TypeError on Chrome.",   "severity": "high",   "createdAt": "2025-12-16T02:30:56.666Z",   "updatedAt": "2025-12-16T02:31:39.892Z",   "entryCount": 1,   "severityScore": 3 }`

* * *

## GET /reports/:id?include=entries,attachments — Expanded view

### 

Example:

`http://localhost:3000/reports/1?include=entries,attachments`

With pagination:

`http://localhost:3000/reports/1?include=entries,attachments&page=1&pageSize=10&order=desc`

Returns:

*   nested `entries`
    
*   nested `attachments`
    

* * *

## PUT /reports/:id — Update report

### 

**URL:** `http://localhost:3000/reports/1`  
**Method:** PUT

### Developer example:

### 

`{   "description": "Updated steps to reproduce." }`

### Admin severity escalation:

### 

`{   "severity": "critical" }`

Developer trying to set severity to critical:

`{   "error": "Only admins can escalate severity to critical" }`

* * *

## DELETE /reports/:id — Delete report (admin only)

### 

`DELETE http://localhost:3000/reports/1`

**Auth:** `{{ADMIN_TOKEN}}`

Response:

`204 No Content`

* * *

## (Optional) POST /reports/bulk — Bulk create reports

### 

**URL:** `http://localhost:3000/reports/bulk`  
**Auth:** `{{ADMIN_TOKEN}}`

**Body:**

`[   {     "title": "Bulk bug #1",     "description": "First bug in bulk upload",     "severity": "low"   },   {     "title": "Bulk bug #2",     "description": "Second bug in bulk upload",     "severity": "high"   } ]`

* * *

# 3\. Report Entries (Comments)

## POST /reports/:id/entries — Add a comment

### 

`POST http://localhost:3000/reports/1/entries`

**Body:**

`{   "comment": "Reproduced on Chrome 120. Investigating." }`

To view entries:

`GET http://localhost:3000/reports/1?include=entries`

* * *

# 4\. Attachments

## POST /reports/:id/attachment — Upload a file

### 

**Method:** POST  
**URL:** `http://localhost:3000/reports/1/attachment`  
**Auth:** Bearer token

**Body Setup (Postman):**

*   Select **Body → form-data**
    
*   Key: `file`
    
*   Type: `File`
    
*   Select a file from your computer
    

**Response Example:**

`{   "downloadUrl": "http://localhost:3000/reports/1/attachment/8ef3727c800e686c892be9e09c5da022?token=eyJhbGciOi..." }`

This is a **signed short-lived download URL**.

* * *

## GET /reports/:id/attachment/:filename?token=... — Download file

### 

Use the **exact URL** returned from upload.

**Authorization:** _No Auth_  
Token is in the query string.

If token is expired or altered → 401 or 403.

* * *

# Custom Business Rule

### Only users with role `admin` may change a report’s severity to `critical`.

### Applies to:

### 

`PUT /reports/:id`

### Behavior:

### 

*   **Admin** → can set severity to any value.
    
*   **Developer** → can set to `low`, `medium`, `high` only.
    

Developer trying to escalate receives:

`{   "error": "Only admins can escalate severity to critical" }`

### Why this matters:

### 

*   Enforces authorization rules
    
*   Protects critical severity classification
    
*   Demonstrates auth + validation + business rule integration
    

* * *

# Notes

### 

This project uses:

*   In-memory storage (`ReportStore`)
    
*   Local disk (`uploads/`) for attachments
    

### In production, you would:

### 

*   Use a real database
    
*   Use S3/GCS for attachments
    
*   Add malware scanning
    
*   Implement optimistic concurrency (ETag)
    
*   Add CI tests
    
*   Add structured logging
    

* * *
