# Better Fork(POS) - School Feeding & Cafeteria Platform

SmartPOS is a web-based platform for managing school feeding programs: student wallets, cafeteria POS, inventory, finances, parent engagement, and biometric fingerprint enrollment.

Built with React, Express, Prisma, and PostgreSQL (Supabase). A local **FingerprintScanner** service connects ZKTeco USB scanners (e.g. **ZK9500**) for admin enrollment of student fingerprints.

---

## Features

| Area | Capabilities |
|------|----------------|
| **Admin** | Dashboard, user management (students, parents, staff), reports, audit logs, pending approvals |
| **Students** | Cafeteria ordering, wallet balance, M-Pesa top-up, purchase history |
| **Parents** | Linked students, **M-Pesa STK Push** wallet top-ups (Safaricom Daraja) |
| **Restaurant** | POS terminal, menu management, inventory |
| **Finance** | Revenue summary, expenses, receipt records |
| **Biometrics** | Fingerprint capture during student enrollment; duplicate detection (exact + SDK match) |
| **Security** | JWT auth, bcrypt passwords, audit logging on mutating actions |

### Student records

Students are identified by **registration number** and **password**. Fields stored:

- Name, reg no, phone, gender, password
- Wallet balance, optional parent link
- Optional fingerprint template (ZKTeco, base64-encoded)

Course, year, and email are **not** used for students.

---

## Tech stack

| Layer | Technologies |
|-------|----------------|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, React Router, Axios, SweetAlert2 |
| **Backend** | Node.js, Express, TypeScript, Prisma, JWT, Bcrypt |
| **Database** | PostgreSQL (Supabase) |
| **Scanner service** | .NET 8, ZKTeco ZKFinger SDK (`libzkfpcsharp`) |

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Supabase](https://supabase.com/) project (or local PostgreSQL)
- **Fingerprint enrollment PC (Windows):**
  - [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
  - ZKTeco **ZK9500** (or compatible ZK USB scanner) + official drivers

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/BKerio/SmartPOS.git
cd SmartPOS
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` with your Supabase `DATABASE_URL`, `DIRECT_URL`, and `JWT_SECRET`.

Push the schema and seed sample data:

```bash
npx prisma db push
npm run db:seed
```

### 3. Frontend

```bash
cd ../frontend
npm install
```

Optional: create `frontend/.env` to override the API URL:

```env
VITE_API_URL=http://localhost:5000/api
VITE_FINGERPRINT_SCANNER_URL=http://127.0.0.1:17890
```

Default dev API: `http://localhost:5000/api`.

### 4. Fingerprint scanner service (enrollment PC)

See [ZK9500 scanner setup](#zk9500-fingerprint-scanner-setup) below.

---

## Running the application

Use **three terminals** when enrolling fingerprints (scanner service only needed on the admin/enrollment machine).

**Terminal 1 - Backend**

```bash
cd backend
npm run dev
```

Runs at `http://localhost:5000`.

**Terminal 2 - Frontend**

```bash
cd frontend
npm run dev
```

Opens at `http://localhost:5173`.

**Terminal 3 - Fingerprint scanner (Windows, USB scanner attached)**

```bash
cd FingerprintScanner
dotnet run
```

Runs at `http://127.0.0.1:17890`.

---

## Default login credentials

Seeded by `npm run db:seed` (change via `SEED_*` in `backend/.env`).

| Role | Login | Password | Lands on |
|------|--------|----------|----------|
| **Admin** | `admin@smartpos.com` | `Admin@12345` | `/` (dashboard) |
| **Student** | `STU001` (reg/adm no) | `Student@12345` | `/student/order` |
| **Parent** | `parent@smartpos.com` | `Parent@12345` | `/parent-dashboard` |
| **Finance** | `finance@smartpos.com` | `Finance@12345` | `/finance` |
| **Restaurant** | `restaurant@smartpos.com` | `Restaurant@12345` | `/pos` |

Sample student wallet: **KES 500**. Sample menu items are seeded (Ugali Beef, Chapati Beans, Tea & Mandazi).

---

## Routes overview

### Frontend

| Path | Role | Description |
|------|------|-------------|
| `/login` | Public | Multi-role login |
| `/` | Admin | Dashboard |
| `/manage-users` | Admin | Students, parents, finance & restaurant staff |
| `/student/order` | Student | Cafeteria menu & checkout |
| `/student-fees` | Student | Wallet & purchase history |
| `/paymyfees` | Student | M-Pesa top-up |
| `/parent-dashboard` | Parent | Linked students & M-Pesa wallet top-ups |
| `/pos` | Restaurant | Staff POS terminal |
| `/menu-management` | Restaurant | Menu CRUD |
| `/inventory` | Restaurant / Finance | Stock management |
| `/finance` | Finance | Revenue dashboard |
| `/expenses` | Finance | Expense records |
| `/receipts` | Finance | POS receipts |

### Backend API (prefix `/api`)

| Module | Examples |
|--------|----------|
| `admin` | `POST /login`, `GET /profile` |
| `students` | `POST /login`, `GET /`, `POST /`, `POST /check-fingerprint` |
| `parents` | `POST /login`, `GET /students` |
| `users` | Staff CRUD, approve/reject |
| `wallet` | `GET /balance`, `POST /topup`, `POST /deposit` |
| `menu` | `GET /`, `POST /` |
| `pos` | `POST /sale`, `POST /student-order`, `GET /receipts` |
| `inventory` | Items, movements, suppliers |
| `finance` | Summary, expenses |
| `audit` | `GET /events` |
| `mpesa` | `POST /stkpush`, `POST /stkpush/callback`, `GET /stkpush/status/:id` |

---

## M-Pesa wallet top-ups (Safaricom Daraja)

> **Active integration:** SmartPOS uses **Safaricom Daraja STK Push** only. Parent top-ups go through `/api/mpesa/*`.  
> Prefer **KopoKopo (K2 Connect)** instead? See [KopoKopo alternative](#kopokopo-alternative-k2-connect) - same wallet flow, different API provider.

Parents can load a linked student's wallet from **Parent Dashboard → Top Up**: select the child, enter M-Pesa phone + amount, approve the STK prompt on the phone. On success the wallet is credited automatically and a `WalletTransaction` is recorded.

### Daraja flow

```
Parent UI  →  POST /api/mpesa/stkpush { studentId, phone, amount }
           →  Safaricom STK Push to parent's phone
           →  POST /api/mpesa/stkpush/callback (Daraja)
           →  Credit student wallet + Socket.IO event to browser
```

Real-time status uses **Socket.IO** (room = `CheckoutRequestID`) with HTTP polling fallback.

### Daraja backend configuration

Add to `backend/.env` (see `.env.example`):

```env
MPESA_BASE_URL=https://sandbox.safaricom.co.ke or https://api.safaricom.co.ke
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=174379
MPESA_PASSKEY=your_lipa_na_mpesa_passkey
TILL_NO=174379
MPESA_TRANSACTIONTYPE=CustomerPayBillOnline
MPESA_CALLBACK_URL=https://your-public-host/api/mpesa/stkpush/callback
```

**Callback URL** must be publicly reachable over **HTTPS**. For local dev, use [ngrok](https://ngrok.com/):

```bash
ngrok http 5000
# Set MPESA_CALLBACK_URL=https://xxxx.ngrok-free.app/api/mpesa/stkpush/callback
# MPESA_CALLBACK_URL=https://api.betterfork.com/api/mpesa/stkpush/callback
```

Optional frontend socket URL (defaults to API host without `/api`):

```env
VITE_SOCKET_URL=http://localhost:5000
```

### Database

M-Pesa records are stored in PostgreSQL (`mpesa_payments` table via Prisma). Fields include `checkoutRequestId`, receipt, amount, `studentId`, `parentId`, and `walletCredited`.

### Daraja API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/mpesa/stkpush` | Parent | Initiate STK push for a linked student |
| `POST` | `/api/mpesa/stkpush/callback` | Public | Daraja callback (Safaricom only) |
| `GET` | `/api/mpesa/stkpush/status/:checkoutRequestId` | Parent/Admin | Poll payment status |
| `GET` | `/api/mpesa/transactions` | Parent/Admin/Finance | Recent M-Pesa payments |

---

## KopoKopo alternative (K2 Connect)

[KopoKopo](https://kopokopo.com/) (K2 Connect) is an M-Pesa payments aggregator. It can replace direct Daraja for STK Push if you want KopoKopo to manage till numbers, webhooks, and settlement - **this repo does not ship a KopoKopo backend route**; the notes below are for teams swapping Daraja for K2 Connect while keeping the same parent top-up UX.

### When to use KopoKopo vs Daraja

| | **Daraja (current)** | **KopoKopo (alternative)** |
|--|----------------------|----------------------------|
| Setup | Safaricom Developer Portal credentials | [KopoKopo sandbox](https://sandbox.kopokopo.com/applications) app key + secret |
| STK endpoint | `POST .../mpesa/stkpush/v1/processrequest` | `POST .../api/v2/incoming_payments` |
| Auth | Consumer key/secret → OAuth token | Client ID/secret → OAuth token ([client credentials](https://developers.kopokopo.com/guides/auth/client-credentials-flow.html)) |
| Callback | Daraja `stkCallback` JSON | K2 [incoming payment result](https://developers.kopokopo.com/guides/receive-money/mpesa-stk.html) webhook |
| SDK | Custom axios calls in `backend/routes/mpesa.ts` | Official [`k2-connect-node`](https://github.com/kopokopo/k2-connect-node) (optional) |

### KopoKopo STK flow (equivalent to Daraja)

```
Parent UI  →  POST /api/v2/incoming_payments  (your backend proxy)
           →  KopoKopo triggers M-PESA STK Push
           →  POST your HTTPS callback_url (payment result)
           →  Credit student wallet + notify browser (Socket.IO / poll)
```

### KopoKopo environment variables (if you implement K2)

```env
KOPOKOPO_BASE_URL=https://sandbox.kopokopo.com
KOPOKOPO_CLIENT_ID=your_client_id
KOPOKOPO_CLIENT_SECRET=your_client_secret
KOPOKOPO_TILL_NUMBER=K000000
KOPOKOPO_CALLBACK_URL=https://your-public-host/api/kopokopo/callback
```

Production base URL: `https://api.kopokopo.com`.

### Sample incoming payment request

```http
POST https://sandbox.kopokopo.com/api/v2/incoming_payments
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "payment_channel": "M-PESA STK Push",
  "till_number": "K000000",
  "subscriber": {
    "first_name": "Jane",
    "last_name": "Parent",
    "phone_number": "+254712345678",
    "email": "parent@example.com"
  },
  "amount": { "currency": "KES", "value": 500 },
  "metadata": {
    "student_id": "<studentId>",
    "parent_id": "<parentId>"
  },
  "_links": {
    "callback_url": "https://your-public-host/api/kopokopo/callback"
  }
}
```

On success, KopoKopo returns **HTTP 201** with a `Location` header pointing to the payment resource. Parse the callback payload, verify the payment succeeded, then credit the student wallet the same way `backend/routes/mpesa.ts` does after Daraja's `ResultCode === 0`.

### KopoKopo webhooks (optional)

Register webhooks in the KopoKopo dashboard or via `POST /webhook-subscriptions` for events such as `buygoods_transaction_received`. See [KopoKopo webhooks guide](https://developers.kopokopo.com/guides/webhooks).

### Local testing

Use [ngrok](https://ngrok.com/) (or similar) so `KOPOKOPO_CALLBACK_URL` is HTTPS and reachable from KopoKopo's servers - same requirement as Daraja.

### Node SDK (optional)

```bash
cd backend
npm install k2-connect-node
```

```javascript
const K2 = require('k2-connect-node');
K2.init(process.env.KOPOKOPO_CLIENT_ID, process.env.KOPOKOPO_CLIENT_SECRET, process.env.KOPOKOPO_BASE_URL);

const token = await K2.TokenService.getToken();
await K2.StkService.initiateIncomingPayment({
  tillNumber: process.env.KOPOKOPO_TILL_NUMBER,
  firstName: 'Jane',
  lastName: 'Parent',
  phoneNumber: '+254712345678',
  currency: 'KES',
  amount: 500,
  callbackUrl: process.env.KOPOKOPO_CALLBACK_URL,
  paymentChannel: 'M-PESA STK Push',
  accessToken: token.access_token,
  metadata: { student_id: studentId, parent_id: parentId },
});
```

**Docs:** [developers.kopokopo.com](https://developers.kopokopo.com/) · [M-PESA STK guide](https://developers.kopokopo.com/guides/receive-money/mpesa-stk.html)

---

## ZK9500 fingerprint scanner setup

The browser cannot access USB fingerprint hardware directly. SmartPOS uses a **local .NET service** (`FingerprintScanner/`) that talks to the ZKTeco SDK; the admin UI calls it over HTTP during enrollment.

```
[Admin browser]  →  POST /capture          →  [FingerprintScanner :17890]
       ↓                                              ↓
  POST /api/students                         ZK9500 USB + drivers
  { fingerprintTemplate }
       ↓
  [PostgreSQL]  students.fingerprintTemplate
```

### Step 1 - Install hardware drivers

1. Connect the **ZK9500** via USB to the enrollment PC (Windows).
2. Get the driver from **Setup**
3. Download and install the **ZKTeco USB fingerprint driver** for your device from [ZKTeco](https://www.zkteco.com/) (or the driver CD / vendor package that ships with the scanner).
4. Open **Device Manager** → confirm the device appears under **Biometric devices** or **USB devices** without a warning icon.
5. If Windows installs a generic driver, replace it with ZKTeco’s **ZKFinger** / **ZK9500** driver when prompted.

### Step 2 - Verify SDK libraries

The project includes the ZKFinger C# wrapper in:

```text
FingerprintScanner/libs/
├── libzkfpcsharp.dll   # .NET binding
└── libzkfp.dll         # Native driver (copied to build output)
```

If capture fails after driver install, copy the matching `libzkfp.dll` and `libzkfpcsharp.dll` from your ZKTeco **ZKFinger SDK** package (must match scanner firmware / SDK version).

### Step 3 - Install .NET 8 SDK

```bash
dotnet --version   # should be 8.x.x
```

Download: https://dotnet.microsoft.com/download/dotnet/8.0

### Step 4 - Build and run the scanner service

```bash
cd FingerprintScanner
dotnet build
dotnet run
```

Expected output:

```text
SmartPOS Fingerprint Scanner Service
Listening on http://127.0.0.1:17890
Endpoints: GET /health  POST /capture  POST /check-duplicate
Scanner ready (1 device(s) detected)
```

**Health check** (browser or curl):

```bash
curl http://127.0.0.1:17890/health
```

### Step 5 - Configure backend & frontend

In `backend/.env`:

```env
FINGERPRINT_SCANNER_URL=http://127.0.0.1:17890
```

Optional in `frontend/.env`:

```env
VITE_FINGERPRINT_SCANNER_URL=http://127.0.0.1:17890
```

Restart the backend after changing env vars.

### Step 6 - Enroll a student fingerprint

1. Start **backend**, **frontend**, and **FingerprintScanner** (`dotnet run`).
2. Log in as **admin** → **Manage Users** → **Students** → **Add Student** (or edit).
3. In **Fingerprint Enrollment**, confirm **Scanner connected**.
4. Click **Capture Fingerprint** and place the finger on the ZK9500.
5. Save the student - the template is stored in the database.

Duplicate fingers are rejected:

- **Exact** duplicate (same template bytes / hash)
- **Biometric** duplicate (ZKTeco `DBMatch` via `/check-duplicate`)

### Scanner service environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FINGERPRINT_PORT` | `17890` | HTTP listen port |
| `FINGERPRINT_CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |

### Troubleshooting ZK9500

| Issue | What to try |
|-------|-------------|
| `No device found` | Replug USB; reinstall ZKTeco driver; run as same user session (not RDP without device redirect) |
| `Init failed` | Wrong `libzkfp.dll` bitness (use x64 on 64-bit Windows); replace DLLs from official SDK |
| `Scanner offline` in UI | Ensure `dotnet run` is active; check `http://127.0.0.1:17890/health` |
| Build: file locked | Stop a running `FingerprintScanner.exe` (Ctrl+C) before `dotnet build` |
| Duplicate not caught | Scanner service must be running for biometric match; exact duplicates still blocked by DB hash |
| Backend cannot match | `FINGERPRINT_SCANNER_URL` must reach the PC where the scanner is plugged in (localhost for same machine) |

### Maintenance scripts

Backfill fingerprint hashes and remove exact duplicate templates:

```bash
cd backend
npx ts-node -r tsconfig-paths/register scripts/dedupe-fingerprints.ts
```

---

## Project structure

```text
SmartPOS/
├── backend/
│   ├── index.ts                 # Express entry
│   ├── prisma/
│   │   ├── schema.prisma        # Database models
│   │   └── seed.ts              # Default users & menu
│   ├── routes/                  # API route modules
│   ├── middlewares/             # JWT auth guards
│   ├── services/                # Prisma, audit, fingerprint, mpesa, socket
│   └── scripts/                 # DB maintenance (e.g. dedupe fingerprints)
├── frontend/
│   └── src/
│       ├── App.tsx              # Router & shell
│       ├── pages/               # Role portals (admin, student, parent, …)
│       ├── components/          # Sidebars, navbars, UI
│       └── services/            # API client, toasts, fingerprintScanner
└── FingerprintScanner/          # Local ZKTeco capture service (.NET 8)
    ├── Program.cs               # HTTP server (/health, /capture, /check-duplicate)
    ├── FingerprintDevice.cs     # SDK wrapper
    └── libs/                    # libzkfpcsharp.dll, libzkfp.dll
```

---

## Database commands

```bash
cd backend
npm run db:generate    # Regenerate Prisma client
npm run db:push        # Apply schema to database
npm run db:seed        # Seed admin, users, menu, sample student
npm run db:studio      # Prisma Studio GUI
```

---

## Production notes

- Set strong `JWT_SECRET` and production `DATABASE_URL` / `FRONTEND_URL` in backend `.env`.
- Use production Daraja URLs and go-live credentials for M-Pesa (`MPESA_BASE_URL=https://api.safaricom.co.ke`).
- Ensure `MPESA_CALLBACK_URL` is HTTPS and whitelisted in the Safaricom developer portal.
- If you migrate to KopoKopo instead of Daraja, use `KOPOKOPO_BASE_URL=https://api.kopokopo.com` and register production webhook URLs in the KopoKopo dashboard.
- Run `FingerprintScanner` as a Windows service or startup task on each enrollment workstation.
- Fingerprint templates are sensitive - restrict admin access and use HTTPS in production.

---

## License

ISC License.
