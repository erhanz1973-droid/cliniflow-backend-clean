/**
 * Clinifly clinic onboarding & support KB — user-facing UI language (not DB field names).
 * Screens: registration, login, settings profile, directory profile, treatment prices,
 * AI training, doctor app, lead inbox, AI communication, Messenger/WhatsApp setup.
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
        "klinik kodu",
        "klinik kodu nedir",
        "რეგისტრაცია",
        "clinic code what is",
        "invitation code",
        "clinic name as code",
      ],
      userExplanation:
        "The **Register Clinic** page lets you create your Clinifly admin account in a few minutes. " +
        "You choose your own clinic details — nothing is assigned to you by Clinifly except optional campaign codes. " +
        `Open: ${REGISTER_URL}`,
      steps: [
        "Open the clinic registration page (Register Clinic / admin-register).",
        "Enter **Clinic Name** — the public name patients will see.",
        "Choose a **Clinic Code** — any short word your clinic picks to represent you (your clinic name or abbreviation works best, e.g. MOON, ELKO). Doctors and patients enter this same code in the mobile app. Clinifly does not email you a code.",
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
          a: "Clinic Code is **any word you choose** to represent your clinic — your clinic name or a short version is ideal (e.g. MOON, ELKO). Patients and doctors use it in the Clinifly mobile app. Clinifly does not assign it; you invent it at registration.",
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
          a: "Log in with your email, clinic code, and password. Then open **Settings** for clinic info, use **AI Training Center** at the top of Settings, add prices at the bottom, fill **Directory Profile** in the menu, connect WhatsApp/Messenger, and approve your doctors.",
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
        "Use **Communication Channels** (WhatsApp / Messenger links on the same Settings page) to connect numbers. " +
        "**Clinic AI Training** (card at the top of Settings) teaches how the AI represents your clinic. Pricing still comes from the Treatment Price List below.",
      steps: [
        "At the top of **Settings**, click **Open AI Training Center** first — teach how your AI should represent the clinic.",
        "Scroll to **AI Communication** on Settings.",
        "Choose a mode: **Instant AI replies** (~1–5 s), **Wait for human before AI**, or **Human-only** (no auto-reply).",
        "If Instant: adjust **Instant reply delay** slider (0.1–0.3 s recommended).",
        "Set **Clinic weekday hours** (opens/closes) — AI only offers slots inside these hours in your timezone.",
        "Select **Clinic timezone** (e.g. Europe/Istanbul).",
        "Choose **AI calendar booking mode** (e.g. draft booking with staff approval — recommended).",
        "In **Communication Channels**, open **WhatsApp** or **Messenger** to connect your clinic number/Page to the AI inbox.",
        "Save AI communication settings.",
        "Either your assigned doctor or the AI can reply to patients — you choose the mode above (Instant, Wait for human, or Human-only).",
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
      id: "onboard.directory_profile",
      screenKey: "directory_profile",
      topicId: "marketplace_profile",
      priority: 89,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "directory profile",
        "public directory profile",
        "marketplace profile",
        "facebook instagram google",
        "google reviews",
        "social media clinic listing",
        "dizin profili",
        "კატალოგის პროფილი",
        "patient discovery listing",
      ],
      userExplanation:
        "**Directory Profile** (in the admin menu, just above **Settings**) controls how your clinic appears in the patient-facing clinic list. " +
        "Adding Facebook, Instagram, Google Maps/Business, website, and Google review stats helps patients trust your clinic and increases the chance they message you from the directory.",
      steps: [
        "In the admin sidebar, open **Directory Profile** (above Settings).",
        "Under **Social & Web**, add your **Website**, **Facebook**, **Instagram**, and other social links patients can verify.",
        "Under **Reputation & Trust**, paste your **Google Business URL**, **Google Rating**, and **Google Review Count** from Google Business Profile.",
        "Complete missing fields shown in **Profile completion** — richer profiles rank better in patient search.",
        "Turn on **Publish to public directory** when you are ready to appear in the Clinifly patient app clinic list.",
        "Save the profile.",
      ],
      commonMistakes: [
        "Leaving social links empty — patients cannot verify your clinic before messaging.",
        "Skipping Google reviews — trust signals matter for international patients comparing clinics.",
        "Not publishing — profile stays invisible in the patient directory.",
        "Broken URLs — test each link in a browser before saving.",
      ],
      faq: [
        {
          q: "Why does Directory Profile matter?",
          a: "Patients browse clinics in the Clinifly app. A complete profile with social proof (Google reviews, Facebook, Instagram) makes them more likely to open chat or send an inquiry to your clinic.",
        },
        {
          q: "Directory Profile vs Settings?",
          a: "**Settings** = internal clinic info, prices, AI. **Directory Profile** = public-facing listing for patient discovery (social, reviews, publish toggle).",
        },
      ],
      aiSupportAnswers: [
        "Open **Directory Profile** in the menu (above Settings). Add Facebook, Instagram, Google Business/reviews, and website — then publish. This helps patients find and message your clinic from the app list.",
        "Think of Directory Profile as your public shop window; Settings is your back office. Complete both after registration.",
      ],
      tags: ["directory", "marketplace", "social", "google_reviews", "onboarding"],
    },
    {
      id: "onboard.doctor_team_setup",
      screenKey: "doctor_app_registration",
      topicId: "doctor_onboarding",
      priority: 83,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "doctor registration app",
        "register as doctor",
        "doctor clinic code",
        "approve doctor",
        "doctor applications",
        "mobile app doctor",
        "doktor kaydi",
        "ექიმის რეგისტრაცია",
        "download clinifly app doctor",
      ],
      userExplanation:
        "After the clinic admin account is ready, each treating doctor installs the **Clinifly mobile app** from the App Store or Google Play, registers as a **doctor**, and enters your **Clinic Code**. " +
        "The clinic admin approves them under **Doctors** in the admin panel.",
      steps: [
        "Doctor downloads the Clinifly app from the **App Store** (iPhone) or **Google Play** (Android).",
        "In the app, choose **Register** and select the **Doctor** role (not patient).",
        "Enter the same **Clinic Code** your clinic chose at registration (e.g. your clinic name abbreviation).",
        "Complete doctor profile details in the app and submit.",
        "Clinic admin: sidebar → **Doctors** (Doctor applications page).",
        "Find the pending application and click **Approve**.",
        "Approved doctors can use the doctor app for schedule, patient chat, and coordination.",
      ],
      commonMistakes: [
        "Doctor using the wrong clinic code — must match the code from clinic registration exactly.",
        "Registering as patient instead of doctor in the mobile app.",
        "Admin never approving — doctor cannot access clinic patients until approved.",
        "Sharing clinic code publicly before you intend to onboard staff.",
      ],
      faq: [
        {
          q: "What clinic code does the doctor enter?",
          a: "The same **Clinic Code** the clinic owner created at admin registration — not an invitation code. Using your clinic name or a short version is easiest for staff to remember.",
        },
        {
          q: "Where does admin approve?",
          a: "Admin sidebar → **Doctors** → pending applications → **Approve**.",
        },
      ],
      aiSupportAnswers: [
        "Doctors install the Clinifly app, register as **Doctor**, and enter your **Clinic Code**. You approve them in admin under **Doctors**. Same code patients use — the one you picked at clinic signup.",
        "Need a doctor on chat? Approve them first in **Doctors**, then assign them in **Lead inbox** so patients know who replies.",
      ],
      tags: ["doctor", "mobile_app", "clinic_code", "approval", "onboarding"],
    },
    {
      id: "onboard.lead_inbox",
      screenKey: "lead_inbox",
      topicId: "lead_assignment",
      priority: 82,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "lead inbox",
        "assign doctor to lead",
        "who answers patients",
        "primary doctor assignment",
        "needs assignment",
        "patient responder",
        "lid inbox",
        "lead atama",
        "ლიდების ინბოქსი",
      ],
      userExplanation:
        "**Lead inbox** (admin sidebar) is where you confirm which doctor (or coordinator) is the primary responder for incoming patient conversations. " +
        "After approving a doctor, assign them here so patient messages route correctly. Replies can come from that doctor **or** the AI — depending on your **AI Communication** mode in Settings.",
      steps: [
        "Open **Lead inbox** in the admin sidebar.",
        "Review leads under **Needs assignment** (or similar tab for unassigned conversations).",
        "Select a lead and assign your approved doctor as the **primary** responder.",
        "Confirm the doctor is the person who will answer patients (or share the inbox with AI auto-reply).",
        "Optional: enable automatic lead routing in Lead inbox settings so new patients distribute across doctors.",
        "In **Settings → AI Communication**, choose whether **AI**, **human**, or **both** reply on WhatsApp/Messenger (Instant, Wait for human, or Human-only).",
      ],
      commonMistakes: [
        "Approving a doctor but never assigning them in Lead inbox — patients may have no clear owner.",
        "Expecting AI to reply when **Human-only** is selected in AI Communication.",
        "Assigning a doctor who is not yet approved in **Doctors**.",
      ],
      faq: [
        {
          q: "Can AI and a doctor both reply?",
          a: "Yes. Set **AI Communication** to Instant or Wait for human for AI auto-replies; your assigned doctor can also reply from admin or the doctor app. Human-only turns off AI auto-reply.",
        },
        {
          q: "When should I use Lead inbox?",
          a: "Right after your first doctor is approved — assign them so inbound patient chats from WhatsApp, Messenger, or the app have a responsible clinician.",
        },
      ],
      aiSupportAnswers: [
        "After approving a doctor under **Doctors**, open **Lead inbox** and assign them as primary responder. AI can help too — check **Settings → AI Communication** for Instant vs Human-only.",
        "Lead inbox = who owns patient conversations. AI Communication = how fast AI jumps in. Set both after your team is approved.",
      ],
      tags: ["lead_inbox", "assignment", "doctors", "ai", "onboarding"],
    },
    {
      id: "onboard.getting_started",
      screenKey: "onboarding_overview",
      topicId: "getting_started",
      priority: 98,
      locales: ["en", "tr", "ka", "ru"],
      questions: [
        "how to get started",
        "first steps after register",
        "onboarding checklist",
        "what to configure first",
        "setup order",
        "kurulum sirasi",
        "klinik nasil kurulur",
        "clinic setup guide",
        "step by step clinifly",
        "customer support help",
      ],
      userExplanation:
        "Full Clinifly clinic onboarding — recommended order after **Register Clinic**. " +
        "Clinic Code is **any word you choose** (your clinic name works best). If anything is unclear, Clinifly **customer support** will help.",
      steps: [
        "1. **Register Clinic** at " + REGISTER_URL + " — pick **Clinic Name** and **Clinic Code** (any short word; clinic name or abbreviation is ideal).",
        "2. **Log in** at " + LOGIN_URL + " with email + clinic code + password.",
        "3. **Settings** → enter clinic information (name, address, logo, chairs, referral discount) → **Save Settings**.",
        "4. Top of **Settings** → **Open AI Training Center** → teach the AI how your clinic should represent itself to patients.",
        "5. Bottom of **Settings** → **Treatment Price List** → enter prices; the AI will suggest approximate prices to patients from this list.",
        "6. Admin menu (above Settings) → **Directory Profile** → add Facebook, Instagram, Google Business/reviews, website → publish — patients are more likely to message you from the clinic list.",
        "7. Doctors: download the Clinifly app (App Store / Google Play) → register as **Doctor** → enter your **Clinic Code**.",
        "8. Admin → **Doctors** → **Approve** the doctor application.",
        "9. Admin → **Lead inbox** → assign that doctor as the primary person who answers patients.",
        "10. Patient messages can be answered by the assigned doctor **or** the AI (your choice in AI Communication).",
        "11. **Settings** → **Communication Channels** → connect **WhatsApp** and/or **Messenger** to link your number/Page to the AI coordinator.",
        "12. Stuck? Clinifly customer support will help you finish setup.",
      ],
      commonMistakes: [
        "Skipping login after registration — nothing works until you log in.",
        "Training AI before saving clinic info and prices — AI quotes wrong or generic answers.",
        "Forgetting Directory Profile — clinic is hard to find in the patient app.",
        "Doctor registers with wrong clinic code or admin forgets to approve.",
        "Connecting WhatsApp/Messenger before prices and AI Training — auto-replies lack your real data.",
        "Not assigning anyone in Lead inbox — unclear who owns patient chats.",
      ],
      faq: [
        {
          q: "What is Clinic Code?",
          a: "Any word your clinic chooses at registration — preferably your clinic name or a short version. Same code for doctors in the mobile app and for patients linking to your clinic.",
        },
        {
          q: "Doctor or AI answers messages?",
          a: "Both are possible. Approve and assign a doctor in Lead inbox; set AI Communication to Instant or Wait for human if you want AI auto-replies on WhatsApp/Messenger too.",
        },
        {
          q: "Need human help?",
          a: "Yes — contact Clinifly customer support anytime during setup. The AI can explain screens; support resolves account, Meta, or technical blockers.",
        },
      ],
      aiSupportAnswers: [
        "Quick path: Register → Login → Settings (info + AI Training + prices) → Directory Profile → approve doctor in **Doctors** → assign in **Lead inbox** → connect WhatsApp/Messenger in Settings. Clinic Code = any word you pick; clinic name is best.",
        "After registration, log in first. Settings top = **AI Training Center**; Settings bottom = prices. **Directory Profile** (above Settings in menu) = Facebook/Instagram/Google reviews. Need hands-on help? Our customer support team can assist.",
      ],
      tags: ["onboarding", "overview", "checklist", "customer_support"],
    },
  ];
}

module.exports = { getBundledCliniflyOnboardingKb, REGISTER_URL, LOGIN_URL };
