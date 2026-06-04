/**
 * Clinifly clinic onboarding & support KB — user-facing UI language (not DB field names).
 * Screens: registration, login, settings profile, treatment prices, AI communication,
 * Messenger setup, WhatsApp setup.
 */

const REGISTER_URL =
  "https://cliniflow-backend-clean-production.up.railway.app/admin-register.html";
const LOGIN_URL =
  "https://cliniflow-backend-clean-production.up.railway.app/admin-login.html";

/**
 * @typedef {object} OnboardingKbEntry
 * @property {string} id
 * @property {string} screenKey
 * @property {string} topicId
 * @property {number} priority
 * @property {string[]} locales
 * @property {string[]} questions
 * @property {string} userExplanation
 * @property {string[]} steps
 * @property {string[]} commonMistakes
 * @property {{ q: string, a: string }[]} faq
 * @property {string[]} aiSupportAnswers
 * @property {string[]} tags
 */

/** @returns {OnboardingKbEntry[]} */
function getBundledCliniflyOnboardingKb() {
  return [
    {
      id: "onboard.clinic_register",
      screenKey: "clinic_registration",
      topicId: "registration",
      priority: 95,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "how do i register my clinic",
        "register new clinic",
        "clinic registration",
        "admin register",
        "sign up clinic",
        "klinik kaydi",
        "რეგისტრაცია",
        "clinic code what is",
        "invitation code",
      ],
      userExplanation:
        "The **Register Clinic** page lets you create your Clinifly admin account in a few minutes. " +
        "You choose your own clinic details — nothing is assigned to you by Clinifly except optional campaign codes. " +
        `Open: ${REGISTER_URL}`,
      steps: [
        "Open the clinic registration page (Register Clinic / admin-register).",
        "Enter **Clinic Name** — the public name patients will see.",
        "Choose a **Clinic Code** — a short unique code your clinic invents (e.g. MOON, CEM). Patients use this later in the Clinifly patient app to connect to your clinic. It is not a code Clinifly emails you.",
        "Optional: **Invitation Code** — only if Clinifly or a partner gave you a campaign code for an extended premium trial.",
        "Enter **Email** and **Password** (minimum 6 characters), then **Confirm password**.",
        "Optional: **Phone** and **Address** — helps patients find you; address is used for maps/nearby search after you save settings.",
        "Click **Register Clinic**. Then log in with the same email, clinic code, and password.",
      ],
      commonMistakes: [
        "Waiting for Clinifly to send a Clinic Code — you create it yourself during registration.",
        "Using spaces or special characters in Clinic Code — keep it short, letters/numbers only (e.g. MOON, ISTANBUL01).",
        "Choosing a code already taken — pick another; the form will tell you if it exists.",
        "Skipping Confirm password or mismatched passwords.",
        "Confusing Invitation Code with Clinic Code — invitation is optional marketing/trial; clinic code is your permanent patient link.",
        "Going to clinifly.net/sign-up — use admin-register.html on the Clinifly admin host instead.",
      ],
      faq: [
        {
          q: "What is Clinic Code?",
          a: "Clinic Code is a unique code **chosen by your clinic** during registration (e.g. MOON, CEM). Patients enter this code in the Clinifly patient app to connect with your clinic. Clinifly does not assign it unless you are copying an existing clinic’s code by mistake.",
        },
        {
          q: "Do I need an Invitation Code?",
          a: "No. Invitation Code is optional — use it only if you received a campaign or partner code for a special trial.",
        },
        {
          q: "Is registration free?",
          a: "Yes. Registration is free and does not require a credit card. You can explore Clinifly and connect channels after login.",
        },
        {
          q: "What happens after I register?",
          a: "Log in with your email, clinic code, and password. Then open **Settings** to complete your profile, prices, and connect WhatsApp or Messenger.",
        },
      ],
      aiSupportAnswers: [
        "Registration is free and takes a few minutes at " +
          REGISTER_URL +
          ". Choose your own **Clinic Code** (e.g. MOON) — patients will use it later in the app; Clinifly does not send you a code. Need help with a field?",
        "Clinic Code is **your** short identifier, not something we issue by email. After registering, log in at " +
          LOGIN_URL +
          " with email + clinic code + password.",
      ],
      tags: ["registration", "clinic_code", "signup", "onboarding"],
    },
    {
      id: "onboard.clinic_login",
      screenKey: "clinic_login",
      topicId: "login",
      priority: 90,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "how to login",
        "clinic login",
        "forgot password",
        "cannot log in",
        "admin login",
        "giris yap",
        "შესვლა",
        "wrong clinic code login",
      ],
      userExplanation:
        "The **Clinic Login** page is for staff who already registered. You need three things: the email you registered with, your **Clinic Code**, and your password. " +
        `Login: ${LOGIN_URL}. New clinics use **Register New Clinic** instead.`,
      steps: [
        "Open Clinic Login (admin-login).",
        "Enter **Email** — the same address you used at registration.",
        "Enter **Clinic Code** — the code your clinic chose at signup (not an invitation code).",
        "Enter **Password**.",
        "Click **Login** to open the admin dashboard.",
        "If you forgot your password, use **Forgot password?** before trying random codes.",
      ],
      commonMistakes: [
        "Using another clinic’s code or a code Clinifly ‘sent’ you — use the code you created at registration.",
        "Typing email instead of clinic code in the Clinic Code field.",
        "Trying to log in before finishing registration.",
        "Caps Lock on password; clinic code is usually uppercase but stored as you entered it.",
      ],
      faq: [
        {
          q: "I forgot my Clinic Code",
          a: "It is the code **you chose** when registering (shown on the registration form). Check your registration confirmation or ask whoever set up the account. Clinifly support can help verify the clinic name on file but does not replace your code by default.",
        },
        {
          q: "Invalid credentials",
          a: "Confirm email, clinic code, and password. All three must match the registered clinic. Reset password via Forgot password if needed.",
        },
        {
          q: "Register New Clinic vs Login",
          a: "Already registered → Login. First time → Register New Clinic (registration page).",
        },
      ],
      aiSupportAnswers: [
        "Log in at " +
          LOGIN_URL +
          " with **email**, **clinic code** (the one you picked at signup), and **password**. Clinic Code is not emailed by Clinifly — it’s your clinic’s chosen code.",
        "New clinic? Use Register New Clinic at " + REGISTER_URL + ". Existing clinic? Use Login with email + clinic code + password.",
      ],
      tags: ["login", "password", "clinic_code", "onboarding"],
    },
    {
      id: "onboard.settings_profile",
      screenKey: "settings_clinic_profile",
      topicId: "clinic_profile",
      priority: 88,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "clinic settings",
        "referral discount",
        "clinic address settings",
        "chair count",
        "google maps link",
        "clinic logo",
        "save settings",
        "referans indirimi",
      ],
      userExplanation:
        "**Clinic Settings** (Settings in the sidebar) is your clinic’s public profile and referral rules. " +
        "Set how much discount referrers and new patients get, your name, logo, address, chair count for the calendar, and Google Maps link. Click **Save Settings** after changes.",
      steps: [
        "In the admin sidebar, open **Settings**.",
        "Under **Referral Discounts**, set **Referral Discount (%)** — both the referrer and the referred patient receive this discount on eligible treatments.",
        "Fill **Clinic Name** as patients should see it.",
        "Optional **Clinic Logo URL** — image link; logo display may depend on your plan.",
        "Enter **Clinic Address** — required for all plans; used for nearby search and map pin (geocoded).",
        "Set **Chair count** — how many chairs appear on your appointment calendar (e.g. 1, 2, 4).",
        "Paste **Google Maps Link** — helps patients open directions.",
        "Click **Save Settings** at the top.",
      ],
      commonMistakes: [
        "Forgetting Save Settings — changes are not applied until you save.",
        "Setting referral discount very high without understanding both parties get the same % — preview warns you on high values.",
        "Leaving address empty — breaks location features.",
        "Chair count zero or wrong — calendar shows too few/many columns.",
        "Broken logo URL — use a direct image link that opens in the browser.",
      ],
      faq: [
        {
          q: "What does Referral Discount (%) do?",
          a: "When your referral program is active, this percentage is applied as a discount for **both** the patient who referred and the new patient who joined — on qualifying treatments you configure elsewhere.",
        },
        {
          q: "Why is address required?",
          a: "Clinifly uses it for patient nearby search and mapping your clinic pin.",
        },
        {
          q: "What is Chair count?",
          a: "Number of dental chairs shown as columns on the internal appointment calendar — not the number of staff logins.",
        },
      ],
      aiSupportAnswers: [
        "Open **Settings** in the admin menu. Set referral %, clinic name, address, chair count, and Maps link, then press **Save Settings**. Address is required for location features.",
        "Referral Discount (%) applies to **both** referrer and new patient. Clinic Code for patients is separate — set at registration, not on this page.",
      ],
      tags: ["settings", "profile", "referral", "address", "onboarding"],
    },
    {
      id: "onboard.settings_prices",
      screenKey: "settings_treatment_prices",
      topicId: "treatment_prices",
      priority: 87,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "treatment price list",
        "set prices",
        "variants straumann",
        "ai names treatments",
        "currency try",
        "how does ai know prices",
        "tedavi fiyat",
      ],
      userExplanation:
        "The **Treatment Price List** in Settings is the single place for appointment prices and AI coordinator answers about cost. " +
        "Pick currency, set each treatment’s price, duration, break, and active flag. Use **Variants** for brands/materials (e.g. Straumann, Megagen). Use **AI names** only for translated display labels — not for brands.",
      steps: [
        "Go to **Settings** → **Treatment Price List** section.",
        "Choose **Currency** (e.g. TRY, USD, EUR).",
        "For each row: set **Price**, **Duration (min)**, **Break (min)**, and keep **Active** checked if offered.",
        "Click **Variants** on a treatment to add brand/material options with different prices.",
        "Click **AI names** only if you want the AI to show another language label — do not put brand names here.",
        "Save settings when finished.",
      ],
      commonMistakes: [
        "Putting implant brand names under AI names instead of Variants.",
        "Leaving price 0 on active treatments — AI may quote free incorrectly.",
        "Wrong duration — AI offers slots that do not match your real chair time.",
        "Forgetting to activate new treatments — inactive rows are ignored.",
        "Changing currency without revisiting all prices.",
      ],
      faq: [
        {
          q: "Variants vs AI names?",
          a: "**Variants** = real options (brand, material, price). **AI names** = optional friendlier or translated names for the same treatment — not a second price list.",
        },
        {
          q: "Why does the AI quote wrong prices?",
          a: "Update this list and save. The AI reads active treatments and variants from here — not from old brochures or Messenger chat history.",
        },
      ],
      aiSupportAnswers: [
        "In **Settings → Treatment Price List**, set currency and prices per treatment. Use **Variants** for Straumann/Megagen-style options; **AI names** are only for display translations.",
        "If patients hear wrong prices, check this list is saved, treatments are **Active**, and variants have correct amounts.",
      ],
      tags: ["settings", "pricing", "variants", "ai_coordinator", "onboarding"],
    },
    {
      id: "onboard.settings_ai",
      screenKey: "settings_ai_communication",
      topicId: "ai_communication",
      priority: 86,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "ai communication settings",
        "instant ai replies",
        "wait for human",
        "human only mode",
        "ai training center",
        "clinic timezone",
        "booking mode",
        "reply delay",
      ],
      userExplanation:
        "**AI Communication** in Settings controls how fast the AI replies on Messenger, Instagram, and WhatsApp, and how scheduling works. " +
        "**Clinic AI Training** (button above) teaches tone and clinic-specific answers. Pricing still comes from the Treatment Price List.",
      steps: [
        "Open **Settings** → **AI Communication**.",
        "Choose a mode: **Instant AI replies** (~1–5 s), **Wait for human before AI**, or **Human-only** (no auto-reply).",
        "If Instant: adjust **Instant reply delay** slider (0.1–0.3 s recommended).",
        "Set **Clinic weekday hours** (opens/closes) — AI only offers slots inside these hours in your timezone.",
        "Select **Clinic timezone** (e.g. Europe/Istanbul).",
        "Choose **AI calendar booking mode** (e.g. full auto vs needs approval).",
        "For deeper answers, click **Open AI Training Center** and complete training topics.",
        "Save settings.",
      ],
      commonMistakes: [
        "Expecting AI to reply when Human-only is selected.",
        "Hours set wrong timezone — offers 9:00 at wrong local time.",
        "Training AI on prices in AI Training instead of Treatment Price List.",
        "Very high reply delay on Instant mode — feels slow to patients.",
      ],
      faq: [
        {
          q: "Instant vs Wait for human?",
          a: "Instant greets patients in seconds. Wait for human lets your team reply first; AI steps in only if no human reply within your configured wait time.",
        },
        {
          q: "Where do I teach the AI about my clinic?",
          a: "Use **Open AI Training Center** for policies and tone. Prices and brands stay in Treatment Price List + Variants.",
        },
      ],
      aiSupportAnswers: [
        "Settings → **AI Communication**: pick Instant, Wait for human, or Human-only. Set opening hours, timezone, and booking mode. Use **AI Training Center** for how the AI talks — not for prices.",
        "If AI does not reply, check you are not on Human-only and WhatsApp/Messenger are connected and live.",
      ],
      tags: ["settings", "ai", "messenger", "whatsapp", "scheduling", "onboarding"],
    },
    {
      id: "onboard.messenger_setup",
      screenKey: "messenger_setup",
      topicId: "messenger_facebook",
      priority: 85,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "connect facebook messenger",
        "messenger setup",
        "facebook page clinifly",
        "ai mode clinifly sales",
        "messenger token",
        "disconnect facebook page",
      ],
      userExplanation:
        "The **Facebook Messenger** page connects your clinic’s Facebook Page so patient chats appear in Clinifly. " +
        "Sign in with a Facebook account that **manages the Page**. After connect, choose the **AI mode** per page (your clinic AI vs Clinifly brand sales AI on Clinifly’s own page).",
      steps: [
        "Sidebar: **Messages** or Settings links → **Messenger**.",
        "Click **Connect Facebook** and approve Meta permissions for the Page.",
        "When connected, you should see your Page listed with webhook and token healthy.",
        "Select **AI mode** for each Page: typical clinics use clinic coordinator AI; only Clinifly’s marketing Page uses Clinifly Sales AI.",
        "Use **Retry permissions** or **Messenger diagnostics** if messages do not arrive.",
        "To remove access, **Disconnect** that Page.",
      ],
      commonMistakes: [
        "Connecting with a personal Facebook account that is not admin on the business Page.",
        "Choosing wrong Page (brand vs clinic local page).",
        "Expecting clinic patient AI on Clinifly corporate Page — that Page may be set to Sales AI intentionally.",
        "Not completing Meta permission retry after password change.",
      ],
      faq: [
        {
          q: "Which Facebook account should I use?",
          a: "One that has **Manage** access to your clinic’s Facebook Page in Meta Business Suite.",
        },
        {
          q: "What is AI mode on the Page?",
          a: "It decides which AI brain answers Messenger on that Page — your clinic patient coordinator vs Clinifly corporate sales. Your clinic Page should use clinic AI, not Sales AI.",
        },
        {
          q: "Token or webhook not ok?",
          a: "Click Retry permissions or Messenger diagnostics, then reconnect if needed.",
        },
      ],
      aiSupportAnswers: [
        "Go to **Messenger** in admin → **Connect Facebook** with an account that manages your clinic Page. After connect, set **AI mode** to your clinic AI (not Sales AI) for your clinic’s Page.",
        "If chats do not appear, run **Messenger diagnostics** and confirm webhook/token show healthy.",
      ],
      tags: ["messenger", "facebook", "meta", "integration", "onboarding"],
    },
    {
      id: "onboard.whatsapp_setup",
      screenKey: "whatsapp_setup",
      topicId: "whatsapp_meta",
      priority: 84,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "connect whatsapp",
        "whatsapp setup",
        "meta whatsapp business",
        "whatsapp callback url",
        "whatsapp connected",
        "go live whatsapp",
        "phone number stays yours",
      ],
      userExplanation:
        "The **WhatsApp** setup page connects your clinic number through Meta (WhatsApp Business). " +
        "Your number stays yours — Clinifly only gets API access. Follow the checklist: Connect with Meta → verify messages → test → configure AI → go live.",
      steps: [
        "Open **WhatsApp** from Settings or Messages (breadcrumb: Settings · Coordination inbox).",
        "Read the green note: your number remains on your Meta Business account.",
        "Step 1: **Connect with Meta** — sign in, pick WhatsApp Business account and phone number.",
        "Step 3: In Meta Developer settings, use the shown **Callback URL** for webhooks if Meta asks (Clinifly displays the correct URL).",
        "Step 4: Send a **test message** to confirm send/receive.",
        "Step 5: **Configure AI** — choose automation level for this number.",
        "Step 6: Turn **WhatsApp ON** when ready to go live.",
        "Pause anytime without losing connection using the pause switch mentioned on the page.",
      ],
      commonMistakes: [
        "Trying to paste Phone Number ID manually when the flow says Meta connect handles it.",
        "Skipping test message before go-live.",
        "Wrong WABA or number selected in Meta — connects another business’s number.",
        "Thinking Clinifly owns the number — ownership stays with your Meta account.",
        "AI not configured while expecting auto-replies on WhatsApp.",
      ],
      faq: [
        {
          q: "Do I need Phone Number ID or WABA ID?",
          a: "On this flow, usually no — **Connect with Meta** guides selection. Use advanced/debug only if support asks.",
        },
        {
          q: "What is the Callback URL for?",
          a: "Meta uses it to deliver incoming WhatsApp messages to Clinifly. Copy the URL shown on the setup page into Meta if required during verification.",
        },
        {
          q: "Connected but AI does not reply?",
          a: "Complete **Configure AI** and go live; check AI Communication mode is not Human-only.",
        },
      ],
      aiSupportAnswers: [
        "Admin → **WhatsApp** → **Connect with Meta**, select your business number, complete the checklist (test message, configure AI, go live). Your number stays on your Meta account.",
        "If status is not Connected, reconnect Meta. If connected but silent, check **Configure AI** and Settings → AI Communication is not Human-only.",
      ],
      tags: ["whatsapp", "meta", "integration", "webhook", "onboarding"],
    },
    {
      id: "onboard.getting_started",
      screenKey: "onboarding_overview",
      topicId: "getting_started",
      priority: 80,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "how to get started",
        "first steps after register",
        "onboarding checklist",
        "what to configure first",
        "setup order",
      ],
      userExplanation:
        "Recommended order after registration: (1) Log in → (2) Settings: profile & address → (3) Treatment prices → (4) AI Communication & Training → (5) Connect WhatsApp and/or Messenger → (6) Invite patients from Patients menu.",
      steps: [
        "Register and log in.",
        "Settings: clinic name, address, chairs, referral % → Save.",
        "Treatment Price List: currency, prices, variants → Save.",
        "AI Communication + AI Training Center.",
        "Connect WhatsApp and/or Facebook Messenger.",
        "Use Patients → Invite Patients when ready.",
      ],
      commonMistakes: [
        "Connecting channels before prices/hours — AI quotes wrong info.",
        "Never opening AI Training — AI stays generic.",
        "Sharing patient app clinic code before you saved settings patients expect.",
      ],
      faq: [
        {
          q: "What is the patient app clinic code?",
          a: "The same **Clinic Code** you created at registration. Patients enter it in the Clinifly patient app to link to your clinic.",
        },
      ],
      aiSupportAnswers: [
        "After login: complete **Settings** (profile + prices), then **AI Communication**, then connect **WhatsApp** and **Messenger**. Your patient-facing code is the Clinic Code you chose at registration.",
        "Start at " + REGISTER_URL + " (new) or " + LOGIN_URL + " (existing). Need step-by-step for one screen? Ask about Registration, Login, Settings, WhatsApp, or Messenger.",
      ],
      tags: ["onboarding", "overview", "checklist"],
    },
  ];
}

module.exports = { getBundledCliniflyOnboardingKb, REGISTER_URL, LOGIN_URL };
