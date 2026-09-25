import type { GuideEntry, SectionRecording } from "../types";

export const PLATFORM_ENTRIES: GuideEntry[] = [
  // ── Account ───────────────────────────────────────────
  {
    slug: "sign-up",
    title: "How to create an account",
    summary: "Register for a new Fitoverse account with your name, email, and password.",
    section: "platform",
    category: "Account",
    keywords: ["sign up", "register", "account", "create", "new"],
    steps: [
      { text: "Open the app and click **Sign up** on the login page" },
      { text: "Enter your full name, email address, and a password", target: "signup-name" },
      { text: "Click **Create Account** to submit your registration", target: "signup-submit" },
      { text: "Wait for an admin to approve your account — you'll be notified when approved" },
    ],
    screenshot: {
      path: "/signup",
      file: "platform-signup.png",
      alt: "Sign up page with registration form",
    },
  },
  {
    slug: "login",
    title: "How to log in",
    summary: "Sign in to your Fitoverse account with email and password.",
    section: "platform",
    category: "Account",
    keywords: ["login", "sign in", "email", "password", "access"],
    steps: [
      { text: "Open the app URL in your browser" },
      { text: "Enter your **email address** and **password**", target: "login-email" },
      { text: "Click **Sign in** to access the dashboard", target: "login-submit" },
      { text: "If your account is pending approval, contact your admin" },
    ],
    screenshot: {
      path: "/login",
      file: "platform-login.png",
      alt: "Login page with email and password fields",
    },
  },
  {
    slug: "reset-password",
    title: "How to reset your password",
    summary: "Recover access to your account by resetting your password via email.",
    section: "platform",
    category: "Account",
    keywords: ["reset", "password", "forgot", "recover", "email"],
    steps: [
      { text: "On the login page, click **Forgot password?**", target: "login-forgot" },
      { text: "Enter your registered email address", target: "forgot-email" },
      { text: "Click **Send reset link** — check your email inbox", target: "forgot-submit" },
      { text: "Click the link in the email and set a new password" },
      { text: "Return to the login page and sign in with your new password" },
    ],
    screenshot: {
      path: "/forgot-password",
      file: "platform-forgot-password.png",
      alt: "Forgot password page with email field",
    },
  },
  {
    slug: "edit-profile",
    title: "How to edit your profile",
    summary: "Update your name, phone number, preferred unit, and change your password.",
    section: "platform",
    category: "Account",
    keywords: ["profile", "name", "phone", "password", "unit", "settings", "edit"],
    steps: [
      { text: "Click your name at the bottom of the sidebar to open **Profile**" },
      { text: "Edit your **display name** and click **Save**", target: "profile-name" },
      { text: "Add or change your **phone number**" },
      { text: "Choose your **preferred unit** (feet or meters) for court dimensions", target: "profile-unit" },
      { text: "To change your password, enter your current password, then the new one and confirm", target: "profile-password" },
    ],
    screenshot: {
      path: "/profile",
      file: "platform-profile.png",
      alt: "Profile page with name, phone, unit, and password sections",
    },
  },

  // ── Installation ──────────────────────────────────────
  {
    slug: "install-pwa",
    title: "How to install the app on your phone",
    summary: "Add Fitoverse to your home screen on Android or iOS for a native app experience.",
    section: "platform",
    category: "Installation",
    keywords: ["install", "android", "ios", "iphone", "mobile", "home screen", "pwa", "app"],
    steps: [
      { text: "Open the app URL in your phone's browser (Chrome on Android, Safari on iOS)" },
      { text: "**Android:** Tap the browser menu (⋮) and select **Add to Home screen**, then tap **Install**" },
      { text: "**iOS:** Tap the **Share** button (↑) in Safari, then tap **Add to Home Screen**" },
      { text: "Name the shortcut and tap **Add** — the app icon appears on your home screen" },
      { text: "Open from the home screen for a full-screen experience without browser controls" },
    ],
    screenshot: {
      path: "/login",
      file: "platform-install-pwa.png",
      alt: "Browser showing Add to Home Screen option",
    },
  },
  {
    slug: "push-notifications",
    title: "How to enable push notifications",
    summary: "Get notified on your device when you receive new messages, reminders, or lead alerts.",
    section: "platform",
    category: "Installation",
    keywords: ["push", "notification", "alert", "enable", "browser", "bell"],
    steps: [
      { text: "Go to **Profile** by clicking your name at the bottom of the sidebar" },
      { text: "Find the **Push Notifications** toggle", target: "profile-push" },
      { text: "Click **Enable** — your browser will ask permission to show notifications" },
      { text: "Click **Allow** in the browser prompt" },
      { text: "You'll now receive notifications for new messages, reminders, and lead alerts" },
    ],
    screenshot: {
      path: "/profile",
      file: "platform-push-notifications.png",
      alt: "Profile page with push notification toggle",
    },
  },

  // ── Navigation ────────────────────────────────────────
  {
    slug: "switch-apps",
    title: "How to switch between Marketing, CRM, and Scout",
    summary: "Navigate between the WhatsApp Marketing, CRM, and Site Scout apps from any sidebar.",
    section: "platform",
    category: "Navigation",
    keywords: ["switch", "navigate", "marketing", "crm", "scout", "sidebar", "app"],
    steps: [
      { text: "In the sidebar, find the app links below the main navigation" },
      { text: "Click **CRM** to open the CRM dashboard in a new tab", target: "sidebar-crm" },
      { text: "Click **Site Scout** to open Site Scout (admin only)", target: "sidebar-scout" },
      { text: "Click **Marketing** (from CRM or Scout) to return to WhatsApp Marketing" },
      { text: "Each app opens in its own named tab so you can switch between them" },
    ],
    screenshot: {
      path: "/inbox",
      file: "platform-switch-apps.png",
      alt: "Sidebar showing CRM and Site Scout navigation links",
    },
  },
  {
    slug: "toggle-theme",
    title: "How to switch between light and dark mode",
    summary: "Toggle between light and dark themes to match your preference.",
    section: "platform",
    category: "Navigation",
    keywords: ["theme", "dark", "light", "mode", "toggle", "appearance"],
    steps: [
      { text: "Scroll to the bottom of any sidebar" },
      { text: "Find the **theme toggle** below the sign-out button", target: "sidebar-theme" },
      { text: "Click it to switch between light mode and dark mode" },
      { text: "Your preference is saved and persists across sessions" },
    ],
    screenshot: {
      path: "/inbox",
      file: "platform-theme-toggle.png",
      alt: "Sidebar footer showing theme toggle control",
    },
  },
];

export const PLATFORM_RECORDING: SectionRecording = {
  slug: "platform-overview",
  title: "Getting Started Overview",
  section: "platform",
  startUrl: "/inbox",
  actions: [
    { type: "caption", text: "Welcome to Fitoverse — your all-in-one sports business platform", duration: 3000 },
    { type: "caption", text: "After logging in, you land on the WhatsApp Marketing Inbox — all your customer conversations appear here", duration: 3000 },
    { type: "highlight", selector: "[data-guide='wa-inbox']", label: "Inbox" },

    { type: "caption", text: "The sidebar lets you navigate between features — Contacts, Broadcasts, Reminders, and more" },
    { type: "highlight", selector: "[data-guide='wa-sidebar-contacts']", label: "Contacts" },
    { type: "highlight", selector: "[data-guide='wa-sidebar-broadcasts']", label: "Broadcasts" },

    { type: "caption", text: "Fitoverse has 3 apps — switch between them using these sidebar links" },
    { type: "highlight", selector: "[data-guide='sidebar-crm']", label: "CRM" },
    { type: "caption", text: "Open CRM to manage leads, deals, and your sales pipeline" },
    { type: "wait", duration: 1500 },
    { type: "highlight", selector: "[data-guide='sidebar-scout']", label: "Site Scout" },
    { type: "caption", text: "Open Site Scout to discover and analyze sports facility locations" },
    { type: "wait", duration: 1500 },

    { type: "caption", text: "Click your name at the bottom of the sidebar to open your Profile" },
    { type: "navigate", url: "/profile" },
    { type: "wait", duration: 2000 },
    { type: "caption", text: "Profile — update your display name, phone number, and preferred measurement unit" },
    { type: "highlight", selector: "[data-guide='profile-name']", label: "Display Name" },
    { type: "caption", text: "Choose feet or meters — this controls how court dimensions are shown across the platform" },
    { type: "highlight", selector: "[data-guide='profile-unit']", label: "Preferred Unit" },
    { type: "caption", text: "Enable Push Notifications so you get alerts for new messages, reminders, and leads" },
    { type: "highlight", selector: "[data-guide='profile-push']", label: "Push Notifications" },
    { type: "caption", text: "You can also change your password from this page anytime" },
    { type: "highlight", selector: "[data-guide='profile-password']", label: "Change Password" },

    { type: "caption", text: "The theme toggle at the bottom of the sidebar lets you switch between Light and Dark mode" },
    { type: "navigate", url: "/inbox" },
    { type: "wait", duration: 2000 },
    { type: "highlight", selector: "[data-guide='sidebar-theme']", label: "Theme Toggle" },
    { type: "caption", text: "Your theme preference is saved and applies across all 3 apps automatically" },
    { type: "wait", duration: 2000 },

    { type: "caption", text: "That's the basics! Explore each section tab above for detailed feature guides", duration: 3000 },
  ],
};
