# Vela

A small full-stack app: a public **landing page** plus an **operator admin portal**.

From the admin portal you can:
- **Add / remove companions** (name, role, description, image or GIF) â€” they appear on the landing page instantly
- **Upload an Android APK** that visitors download from the landing page
- See **real analytics**: website views, clicks, and APK downloads (totals + a 30-day daily chart)

No database server and no native build step â€” data is stored in a JSON file and uploads go to a folder on disk.

---

## Run it

Requires **Node.js 18+**.

```bash
cd vela-app
npm install
npm start
```

Then open:
- Landing page â†’ http://localhost:3000/
- Admin portal â†’ http://localhost:3000/admin

### Set the admin password (do this before exposing it)

The default password is `vela-admin`. Override it with an environment variable.

PowerShell (Windows):
```powershell
$env:ADMIN_PASSWORD="your-strong-password"
$env:SESSION_SECRET="some-long-random-string"
npm start
```

macOS / Linux:
```bash
ADMIN_PASSWORD="your-strong-password" SESSION_SECRET="some-long-random-string" npm start
```

`PORT` is also configurable (defaults to `3000`).

---

## How it fits together

| Path | What it is |
| --- | --- |
| `GET /` | Landing page (`public/landing.html`) |
| `GET /admin` | Admin portal (`public/admin.html`) |
| `GET /api/models` | Public list of companions |
| `GET /api/apk-info` | Public APK metadata (name, size, version, downloads) |
| `GET /download/apk` | Public APK download (counted) |
| `POST /api/track/view` / `POST /api/track/click` | Analytics hits from the landing page |
| `POST /api/login` / `POST /api/logout` / `GET /api/me` | Admin auth |
| `GET /api/stats` | Analytics (auth) |
| `POST /api/models` / `DELETE /api/models/:id` | Manage companions (auth) |
| `POST /api/apk` | Upload / replace the APK build (auth) |

Data lives in `data/db.json`. Uploaded media and the APK live in `uploads/`.
Both folders are created automatically and can be deleted to reset everything.

---

## Before you put this on the internet

This runs as a real server, so a few things matter once it's public:

- **Change the admin password** (`ADMIN_PASSWORD`) and set a fixed `SESSION_SECRET`. With the default secret, sessions reset on every restart.
- **Put it behind HTTPS** (a reverse proxy such as Nginx or Caddy). Then set the session cookie to `secure` in `server.js`.
- **Sessions are in-memory**, so they clear on restart and won't work across multiple instances. For production, add a session store (e.g. `connect-sqlite3` or Redis).
- **Analytics are simple counters** â€” they count every hit, with no de-duplication or bot filtering. If you need unique visitors or geography, put a real analytics tool (Plausible, Umami, GA4) in front, or extend the tracking to log IP + timestamp.
- **Serving an APK outside the Play Store**: make sure you have the right to distribute it, keep the file virus-scanned, and serve it over HTTPS. Users will see an "install from unknown sources" prompt â€” that's expected for sideloaded apps.
- **Uploads are validated** by type and size (images: 15 MB; APK: 500 MB), but anything you accept from the public should still be treated carefully. Only you (the authenticated admin) can upload here.

---

## Reset / backup

- **Back up**: copy `data/db.json` and the `uploads/` folder.
- **Reset everything**: stop the server, delete `data/` and `uploads/`, start again.

