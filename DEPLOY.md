# Going live with Vela

The app is ready to deploy. The one thing that has to be **you** is signing up for a
host â€” I can't create accounts or enter payment on your behalf. Everything else below
I can do with you step by step; just say the word.

---

## The simplest path (Render â€” has a free tier)

1. **Create a free account** at https://render.com (this step is yours).
2. Put the `vela-app` folder on GitHub:
   ```bash
   cd vela-app
   git init
   git add .
   git commit -m "Vela app"
   ```
   Then create an empty repo on GitHub and push to it. (I can run these commands and
   walk you through the GitHub part.)
3. In Render: **New â†’ Web Service â†’ connect your repo**. Render reads the settings
   automatically:
   - Build command: `npm install`
   - Start command: `node server.js`
4. Add two environment variables in Render's dashboard:
   - `ADMIN_PASSWORD` â†’ a strong password of your choice
   - `SESSION_SECRET` â†’ any long random string
5. Deploy. You'll get a public URL like `https://vela.onrender.com`.
   Landing page is at `/`, the admin portal at `/admin`.

Other hosts work the same way: **Railway**, **Fly.io**, or any VPS with Docker
(a `Dockerfile` is included, so `docker build` + `docker run` also works).

---

## Important: uploads and analytics need persistent storage

Vela stores uploaded images, the APK, and the analytics counters on disk
(`data/` and `uploads/`). On **free** hosting tiers the disk is **ephemeral** â€” it
resets every time the app restarts or redeploys, which means **your uploads and
view/download counts would be wiped**.

To keep them permanently you need one of:
- a host with a **persistent disk / volume** mounted at `/app/data` and `/app/uploads`
  (usually a small paid add-on â€” often a few dollars a month), **or**
- external storage for files (e.g. S3-compatible object storage) + a database for the
  counts. This is a code change I can make if you want to go this route.

For trying it out and sharing a demo, the free tier is fine. For a real launch where
the numbers and uploads must stick, plan for the persistent-disk option.

---

## Run it on this computer (no account needed)

```bash
cd vela-app
npm install
npm start
```
Then open http://localhost:3000 (admin at http://localhost:3000/admin).
This is the quickest way to use it right now; it just isn't reachable by other people
over the internet.

