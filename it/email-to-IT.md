**To:** IT team
**Subject:** Request: review and install Local AI Anonymizer, a browser tool for safer AI use

Dear IT team,

Following the all-staff AI policy meeting, anonymizing data before using AI tools outside our systems was recommended. Doing that by hand takes a lot of time, so I built a small browser extension that does it automatically.

**What it does:** when staff paste or type into ChatGPT, Claude, Gemini, Copilot and similar tools, it replaces names, emails, phone numbers, IDs and card numbers with labels like [PERSON_1]. The AI never sees the real details. Staff see the real names again in the reply, on their own screen only.

**Why it is safe:**
- **Everything happens on the user's computer.** The AI model that finds personal data is built into the extension. Nothing is sent to me, to a server or to any other service.
- **Nothing is stored long term.** Real details stay in browser memory and are erased when the browser closes.
- **Fully reviewable.** I developed it myself, and the full source code is included in the package for you to check.
- **No accounts or sign-in.** Works in Chrome and Edge on Windows and Mac.

**The package** (link: [OneDrive/SharePoint link]) contains:
1. The extension (zip)
2. IT install guide (PDF): security details, permissions, and how to deploy it through Intune or Group Policy
3. How to use (PDF): a one-page guide for staff, which also opens automatically after install

Could you review it and, if approved, deploy it to staff devices? I'm happy to walk you through it or answer any questions.

Best regards,
Alan Al-Jammoor
