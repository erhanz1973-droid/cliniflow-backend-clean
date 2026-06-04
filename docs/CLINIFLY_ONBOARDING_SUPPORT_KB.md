# Clinifly Onboarding & Support Knowledge Base

User-facing help for clinic administrators. Written from **UI labels** on admin screens, not database field names.

**Registration:** https://cliniflow-backend-clean-production.up.railway.app/admin-register.html  
**Login:** https://cliniflow-backend-clean-production.up.railway.app/admin-login.html

Machine-readable source: `lib/cliniflyOnboardingKbBundled.js`  
Retrieval: `lib/cliniflyOnboardingKnowledge.js` (also injected into Clinifly Sales AI for setup questions)

---

## 1. Clinic Registration

### User-friendly explanation

The **Register Clinic** page creates your Clinifly admin account in a few minutes. You enter your clinic’s own details. **Clinic Code** is chosen by you — Clinifly does not email you a code. Registration is free and does not require a credit card.

### Step-by-step

1. Open **Register Clinic** (`admin-register.html`).
2. **Clinic Name** — name patients will see.
3. **Clinic Code** — short unique code you invent (e.g. `MOON`, `CEM`). Patients use it later in the Clinifly patient app to connect to your clinic.
4. **Invitation Code** (optional) — only if you received a campaign/partner code.
5. **Email**, **Password** (min. 6 characters), **Confirm password**.
6. Optional: **Phone**, **Address**.
7. Click **Register Clinic**, then **Login** with the same email, clinic code, and password.

### Common mistakes

- Waiting for Clinifly to “send” a Clinic Code.
- Using spaces or odd characters in Clinic Code.
- Confusing **Invitation Code** with **Clinic Code**.
- Using broken links like `clinifly.net/sign-up` — use `admin-register.html` on the Clinifly admin host.

### FAQ

| Question | Answer |
|----------|--------|
| What is Clinic Code? | A unique code **your clinic chooses** at registration. Patients enter it in the Clinifly app to link to your clinic. |
| Do I need an Invitation Code? | No — optional for special trials only. |
| Is it free? | Yes; no credit card for registration. |

### AI support answers

- “Clinic Code is **your** short code (e.g. MOON), not something we email you. Register free at [admin-register URL], then log in with email + clinic code + password.”
- “After registration, open **Settings** to set address and prices, then connect **WhatsApp** or **Messenger**.”

---

## 2. Clinic Login

### User-friendly explanation

**Clinic Login** is for staff who already registered. You need **Email**, **Clinic Code** (the one you created), and **Password**. New clinics use **Register New Clinic** instead.

### Step-by-step

1. Open **Clinic Login**.
2. Enter **Email**, **Clinic Code**, **Password**.
3. Click **Login**.
4. Use **Forgot password?** if needed.

### Common mistakes

- Entering a code Clinifly “assigned” — use the code you picked at signup.
- Swapping email and clinic code fields.
- Logging in before completing registration.

### FAQ

| Question | Answer |
|----------|--------|
| Forgot Clinic Code? | It’s the code you chose at registration; check with whoever set up the account. |
| Invalid credentials? | All three fields must match the registered clinic. |

### AI support answers

- “Use **email**, **clinic code** (from signup), and **password** at the login page.”
- “First time? **Register New Clinic**. Already registered? **Login**.”

---

## 3. Settings — Clinic profile & referrals

### User-friendly explanation

**Settings** holds your public clinic profile and **Referral Discount (%)** — the discount both referrer and new patient receive. Also: name, logo URL, address, chair count, Google Maps link. Always click **Save Settings**.

### Step-by-step

1. Sidebar → **Settings**.
2. **Referral Discount (%)** — discount for both parties in your referral program.
3. **Clinic Name**, **Clinic Logo URL** (optional; plan may affect display).
4. **Clinic Address** (required) — for map and nearby search.
5. **Chair count** — columns on your appointment calendar.
6. **Google Maps Link** — directions for patients.
7. **Save Settings**.

### Common mistakes

- Forgetting **Save Settings**.
- Very high referral % without understanding both patients get it.
- Empty address or wrong chair count.

### FAQ

| Question | Answer |
|----------|--------|
| Referral discount? | % off for **both** referrer and referred patient on qualifying treatments. |
| Chair count? | Number of chairs on the **calendar**, not staff logins. |

### AI support answers

- “Open **Settings**, set referral %, address, chairs, Maps link, then **Save Settings**.”

---

## 4. Settings — Treatment Price List

### User-friendly explanation

**Treatment Price List** is the single source for appointment prices and what the AI tells patients about cost. Use **Variants** for brands (Straumann, Megagen). **AI names** are only for translated labels — not brands.

### Step-by-step

1. **Settings** → **Treatment Price List**.
2. Choose **Currency**.
3. Per treatment: **Price**, **Duration**, **Break**, **Active**.
4. **Variants** for brand/material options.
5. **AI names** only for display translations.
6. Save.

### Common mistakes

- Brands under **AI names** instead of **Variants**.
- Active treatments with price `0`.
- Wrong duration for scheduling.

### FAQ

| Question | Answer |
|----------|--------|
| Variants vs AI names? | Variants = real options and prices; AI names = optional display labels only. |

### AI support answers

- “Set prices in **Settings → Treatment Price List**; use **Variants** for implant brands.”

---

## 5. Settings — AI Communication & Training

### User-friendly explanation

**AI Communication** controls reply speed on Messenger/WhatsApp and scheduling rules. **Open AI Training Center** teaches how your AI talks. Prices still come from the Treatment Price List.

### Step-by-step

1. **Settings** → **AI Communication**.
2. Mode: **Instant AI replies**, **Wait for human**, or **Human-only**.
3. **Instant reply delay** (Instant mode).
4. **Clinic weekday hours** and **Clinic timezone**.
5. **AI calendar booking mode**.
6. **Open AI Training Center** for clinic-specific guidance.
7. Save.

### Common mistakes

- **Human-only** selected but expecting auto-replies.
- Wrong timezone for opening hours.
- Teaching prices in AI Training instead of Price List.

### AI support answers

- “**Settings → AI Communication**: pick Instant / Wait for human / Human-only; set hours and timezone.”

---

## 6. Facebook Messenger setup

### User-friendly explanation

Connect your clinic **Facebook Page** so Messenger chats appear in Clinifly. Use a Facebook account that **manages the Page**. Set **AI mode** per page (clinic AI vs Clinifly Sales AI on Clinifly’s own brand page).

### Step-by-step

1. **Messenger** in admin.
2. **Connect Facebook** → approve permissions.
3. Confirm Page shows healthy webhook/token.
4. Set **AI mode** (your clinic Page → clinic coordinator AI).
5. **Retry permissions** / **Messenger diagnostics** if needed.
6. **Disconnect** to remove.

### Common mistakes

- Personal account without Page admin rights.
- Wrong Page connected.
- Clinic Page set to **Clinifly Sales AI** by mistake.

### AI support answers

- “**Messenger → Connect Facebook** with a Page admin account; set **AI mode** to clinic AI for your clinic Page.”

---

## 7. WhatsApp setup

### User-friendly explanation

Connect WhatsApp through **Meta**. Your number stays on your Meta Business account. Follow the checklist: connect → verify → test → configure AI → go live.

### Step-by-step

1. **WhatsApp** page (from Settings / Messages).
2. **Connect with Meta** — pick business account and number.
3. Use displayed **Callback URL** in Meta if required.
4. **Send test message**.
5. **Configure AI**.
6. Turn **WhatsApp ON** (go live).

### Common mistakes

- Skipping test message or AI configure.
- Wrong number/WABA in Meta.
- Expecting Clinifly to own the phone number.

### AI support answers

- “**WhatsApp → Connect with Meta**, complete checklist, then go live. Number stays yours on Meta.”

---

## Recommended setup order

1. Register → Login  
2. Settings: profile + referral + address  
3. Treatment Price List  
4. AI Communication + AI Training  
5. WhatsApp and/or Messenger  
6. Patients → Invite Patients  

---

## Supabase

1. Run migration `20260605120000_clinifly_onboarding_kb_entries.sql`
2. Optional seed: `node scripts/seed-clinifly-onboarding-kb.cjs`

Until seeded, the app uses `cliniflyOnboardingKbBundled.js` automatically.
