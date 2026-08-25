# Setup

Two jobs, both one-off: put the app on the web, then let it talk to your
OneDrive. Do them in this order — the OneDrive registration needs the web
address from step 1.

---

## 1. Put it online (GitHub Pages, free)

A public HTTPS address is not optional here. Android will only offer "Add to
Home screen", and Microsoft will only accept a sign-in redirect, over HTTPS.
GitHub Pages gives you that for nothing, permanently.

1. Sign in at <https://github.com> (create an account if you have not got one).
2. Click **+** › **New repository**. Name it `shedtracker`, set it to
   **Public**, and create it.
3. On the empty repository page, click **uploading an existing file**.
4. Drag in everything from this folder — `index.html`, `sw.js`,
   `manifest.webmanifest`, and the `css`, `js` and `icons` folders. Keep the
   folder structure; drag the folders themselves, not the files inside them.
   Click **Commit changes**.
5. Go to **Settings** › **Pages**. Under *Source* pick **Deploy from a branch**,
   branch **main**, folder **/ (root)**. Save.
6. Wait a minute or two, then reload that page. It will show your address:

   ```
   https://<your-github-username>.github.io/shedtracker/
   ```

Open that on your phone in Chrome. Tap the ⋮ menu › **Add to Home screen**.
It is now an app.

> Prefer no GitHub account? Drag this folder onto <https://app.netlify.com/drop>
> instead. You get an HTTPS address immediately. Everything below works the
> same; just use the Netlify address wherever this says "your app address".

---

## 2. Connect OneDrive

You are registering the app with Microsoft so it can write into your own
OneDrive. It stays private to you — nobody else needs to be involved, and there
is no cost.

1. Go to <https://entra.microsoft.com> and sign in with the **same Microsoft
   account whose OneDrive you want to use**.
2. In the left menu: **Applications** › **App registrations** › **New
   registration**.
3. Fill in:
   - **Name**: `Shed Tracker`
   - **Supported account types**: *Personal Microsoft accounts only*
     (choose *Accounts in any organizational directory and personal Microsoft
     accounts* if you might also sign in with a work account)
   - **Redirect URI**: change the dropdown to **Single-page application (SPA)**
     and paste your app address, exactly, including the trailing slash:

     ```
     https://<your-github-username>.github.io/shedtracker/
     ```

     The app shows you the exact string to paste — it is on the Settings tab
     under the client-ID box. Copy it from there and you cannot get it wrong.
4. Click **Register**.
5. On the overview page that appears, copy the **Application (client) ID**. It
   looks like `a1b2c3d4-1234-5678-9abc-def012345678`.
6. Open the app on your phone, go to **Settings**, paste that ID into the
   *Application (client) ID* box, and tap **Sign in to OneDrive**.
7. Microsoft asks you to approve one permission — access to *this app's own
   folder*. Approve it.

Done. Tap **Back up now**, then look in OneDrive for
**Apps › Shed Tracker**: your photos and `shedtracker.json` are there.

### Saving into a folder of your own instead

By default backups go into that private app folder, which the app can use but
not browse. If you'd rather it save into a normal folder you already have —
one you can also open yourself in the OneDrive app — do this:

1. In OneDrive, open the folder, choose **Share** › **Copy link**.
2. In the app, go to **Settings**, paste the link under *Backup folder*, and
   tap **Use this folder**.
3. If you signed in before this option existed, tap **Sign out** then **Sign
   in to OneDrive** again first — this needs a broader permission
   (`Files.ReadWrite`, not just the app's own sandboxed folder) that your
   existing sign-in won't have.

Tap **Use the app's private folder instead** at any time to switch back.

### If sign-in fails

| Message | Fix |
| --- | --- |
| `AADSTS50011: redirect URI does not match` | The URI in the app registration is not character-for-character the one the Settings tab shows. Watch the trailing slash. |
| `AADSTS9002326: cross-origin token redemption` | The redirect URI was registered under *Web* instead of **Single-page application**. Delete it and re-add it under the SPA heading. |
| `unauthorized_client` | The account type is set to work accounts only. Edit the registration's *Supported account types* to include personal Microsoft accounts. |
| `AADSTS50020: user account does not exist in tenant 'Microsoft Services'` | Same root cause as above, different wording. Go to the registration's **Authentication** page (or the **Manifest**'s `signInAudience`) and set *Supported account types* to *Accounts in any organizational directory and personal Microsoft accounts*, then sign in again. |

### Signing in again

Microsoft only lets browser apps hold a sign-in for 24 hours. If a backup
reports the session expired, tap **Sign in to OneDrive** again — one tap, no
retyping. Everything on the phone is untouched in the meantime.

---

## 3. Using it on moving day

1. For each tub: **+** → confirm the number → photograph the contents →
   **Scan photos for keywords** → tap the ones that are real → dictate or type
   anything the photos missed → set the status to *sealed*.
2. When a tub goes into a container, open it and set the place and position.
   The next box you create inherits that place automatically.
3. At the end of each day, on wifi, tap the ↻ in the top corner to back up.
4. Later, when you need the good frying pan: type `frying pan` in the search
   box. It tells you box 14, shipping container A, back wall stack 3.

## Updating the app later

Edit the files, bump `VERSION` at the top of `sw.js` (e.g. `mt-v1` → `mt-v2`),
and re-upload to GitHub. Phones pick up the new version next time they open the
app with a connection. Without the version bump they keep serving the cached
old copy.
