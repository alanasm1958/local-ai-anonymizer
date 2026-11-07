// Hand-written evaluation set. `sensitive` must be gone after anonymizing;
// `keep` must survive (catches over-redaction). Names are deliberately
// varied in origin because small English models are weakest on non-Western names.

export const SAMPLES = [
  {
    text: 'Hi team, Ahmed Al-Rashid from Gulf Petro Services asked for the Q3 numbers. Send them to ahmed.alrashid@gulfpetro.example by Friday.',
    sensitive: ['Ahmed Al-Rashid', 'Gulf Petro Services', 'ahmed.alrashid@gulfpetro.example'],
    keep: ['Q3 numbers', 'Friday'],
  },
  {
    text: 'Patient Fatima Hassan (DOB: 03/11/1987, MRN 77120934) reported chest pain. Dr. Michael Brennan ordered an ECG at St Mary\'s Hospital.',
    sensitive: ['Fatima Hassan', '03/11/1987', '77120934', 'Michael Brennan', "St Mary's Hospital"],
    keep: ['chest pain', 'ECG'],
  },
  {
    text: 'Can you rewrite this email to Priya Raman? She is the procurement lead at Tata Consultancy Services and her number is +91 98450 12345.',
    sensitive: ['Priya Raman', 'Tata Consultancy Services', '+91 98450 12345'],
    keep: ['procurement lead', 'rewrite this email'],
  },
  {
    text: 'Wei Zhang and Li Na joined the Shenzhen office last week. Their manager, Kevin O\'Connor, wants onboarding done by Monday.',
    sensitive: ['Wei Zhang', 'Li Na', "Kevin O'Connor", 'Shenzhen'],
    keep: ['onboarding', 'Monday'],
  },
  {
    text: 'Contract between Brightline Logistics Ltd and Harbor & Finch LLP. Invoice INV-2024-00871 for $48,200 is overdue. Contact Sarah Whitfield.',
    sensitive: ['Brightline Logistics Ltd', 'Harbor & Finch LLP', 'INV-2024-00871', 'Sarah Whitfield'],
    keep: ['$48,200', 'overdue'],
  },
  {
    text: 'Customer complaint from Mrs. Gloria Mendoza, account number 4471-2290-11. She lives at 1842 Willow Creek Drive, Austin, TX 78704.',
    sensitive: ['Gloria Mendoza', '4471-2290-11', '1842 Willow Creek Drive', 'TX 78704'],
    keep: ['Customer complaint'],
  },
  {
    text: 'Please summarise the interview notes: candidate Olumide Adeyemi has five years at Flutterwave and previously worked with Chinedu Okafor.',
    sensitive: ['Olumide Adeyemi', 'Flutterwave', 'Chinedu Okafor'],
    keep: ['interview notes', 'five years'],
  },
  {
    text: 'Server prod-db-3 at 10.20.30.41 rejected the key sk-live-9f8e7d6c5b4a3f2e1d0c9b8a. Ping Tomás Herrera on Slack.',
    sensitive: ['10.20.30.41', 'sk-live-9f8e7d6c5b4a3f2e1d0c9b8a', 'Tomás Herrera'],
    keep: ['prod-db-3', 'Slack'],
  },
  {
    text: 'Draft a reference letter for Hannah Becker, who interned with us at Siemens Energy in Munich from June to August.',
    sensitive: ['Hannah Becker', 'Siemens Energy', 'Munich'],
    keep: ['reference letter', 'June to August'],
  },
  {
    text: 'Refund request: card 5555 5555 5555 4444, cardholder Jamal Washington, email jwash88@mail.example, phone (312) 555-0187.',
    sensitive: ['5555 5555 5555 4444', 'Jamal Washington', 'jwash88@mail.example', '(312) 555-0187'],
    keep: ['Refund request'],
  },
  {
    text: 'Meeting notes: Yusuf Demir (Anadolu Bank) and Elena Petrova (Raiffeisen) agreed to share the KYC checklist.',
    sensitive: ['Yusuf Demir', 'Anadolu Bank', 'Elena Petrova', 'Raiffeisen'],
    keep: ['KYC checklist', 'Meeting notes'],
  },
  {
    text: 'Translate for Mr Nguyen Van An: your passport no. B7731902 is ready for collection at the embassy in Hanoi.',
    sensitive: ['Nguyen Van An', 'B7731902', 'Hanoi'],
    keep: ['ready for collection', 'embassy'],
  },
  {
    text: 'Grant application by Dr. Aisha Bello of the University of Lagos, co-authored with Prof. James Whitaker of Oxford.',
    sensitive: ['Aisha Bello', 'University of Lagos', 'James Whitaker', 'Oxford'],
    keep: ['Grant application'],
  },
  {
    text: 'Our IBAN is DE89 3704 0044 0532 0130 00. Transfer the deposit for flat 4B to landlord Klaus Richter.',
    sensitive: ['DE89 3704 0044 0532 0130 00', 'Klaus Richter'],
    keep: ['deposit', 'flat 4B'],
  },
  {
    text: 'Employee ID: EMP-20931. Rachel Goldberg requested parental leave starting 1 March. HR contact is Diego Fernández.',
    sensitive: ['EMP-20931', 'Rachel Goldberg', 'Diego Fernández'],
    keep: ['parental leave', '1 March'],
  },
  {
    text: 'Explain this error to me. Stack trace mentions user mohammed.k@corp.example and token=ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5.',
    sensitive: ['mohammed.k@corp.example', 'ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5'],
    keep: ['Stack trace', 'Explain this error'],
  },
  {
    text: 'Write a thank-you note to the Johnson family for hosting Leila Haddad during her exchange semester in Portland.',
    sensitive: ['Johnson', 'Leila Haddad', 'Portland'],
    keep: ['thank-you note', 'exchange semester'],
  },
  {
    text: 'Case number CV-2023-118842: Marcus Bell v. Northgate Property Management. Hearing at 9am in courtroom 6.',
    sensitive: ['CV-2023-118842', 'Marcus Bell', 'Northgate Property Management'],
    keep: ['Hearing at 9am', 'courtroom 6'],
  },
  {
    text: 'Use Python and Excel to clean the sales data before the Monday standup. No names in this one.',
    sensitive: [],
    keep: ['Python', 'Excel', 'Monday standup', 'sales data'],
  },
  {
    text: 'Ship the samples to 221B Baker Street, London NW1 6XE, attention Ingrid Solberg at Nordic Biotech AS.',
    sensitive: ['221B Baker Street', 'NW1 6XE', 'Ingrid Solberg', 'Nordic Biotech AS'],
    keep: ['Ship the samples'],
  },
  {
    text: 'Feedback on Zainab Abubakar\'s performance review: strong delivery on the Ecobank migration, needs coaching on estimates.',
    sensitive: ['Zainab Abubakar', 'Ecobank'],
    keep: ['performance review', 'coaching on estimates'],
  },
  {
    text: 'Remind Carlos to call Sofia Rossi at Ferrero about the hazelnut order. Her direct line is 020 7946 0321.',
    sensitive: ['Carlos', 'Sofia Rossi', 'Ferrero', '020 7946 0321'],
    keep: ['hazelnut order'],
  },
  {
    text: 'SSN 219-09-9999 belongs to applicant Robert Kim. Background check by Sterling Check came back clear.',
    sensitive: ['219-09-9999', 'Robert Kim', 'Sterling Check'],
    keep: ['Background check', 'came back clear'],
  },
  {
    text: 'Summarise: Omar Farouk, Layla Mansour and Hussein Al-Jaburi will represent Basra Oil Company at the Erbil conference.',
    sensitive: ['Omar Farouk', 'Layla Mansour', 'Hussein Al-Jaburi', 'Basra Oil Company', 'Erbil'],
    keep: ['conference'],
  },
  {
    text: 'Born on 22 July 1979, Daniel Ortega-Ruiz has policy number POL-883920 with Allianz.',
    sensitive: ['22 July 1979', 'Daniel Ortega-Ruiz', 'POL-883920', 'Allianz'],
    keep: [],
  },
  // Prompts that open with a command word: the model is least sure here.
  {
    text: 'Call Priya Raman at Tata Consultancy Services about the renewal.',
    sensitive: ['Priya Raman', 'Tata Consultancy Services'],
    keep: ['about the renewal'],
  },
  {
    text: 'Call Priya Raman at Tata Consultancy Services on +91 98450 12345 about passport no. B7731902.',
    sensitive: ['Priya Raman', 'Tata Consultancy Services', '+91 98450 12345', 'B7731902'],
    keep: [],
  },
  {
    text: 'Email Daniel Okoro the signed contract today.',
    sensitive: ['Daniel Okoro'],
    keep: ['signed contract'],
  },
  {
    text: 'Ask Mei Lin whether the audit is finished.',
    sensitive: ['Mei Lin'],
    keep: ['audit is finished'],
  },
  {
    text: 'Tell Javier Morales that the shipment left Rotterdam on Tuesday.',
    sensitive: ['Javier Morales', 'Rotterdam'],
    keep: ['shipment', 'Tuesday'],
  },
  {
    text: 'Remind Fatou Diallo to submit her visa form.',
    sensitive: ['Fatou Diallo'],
    keep: ['visa form'],
  },
  // Typed in lowercase: the model is cased, so these need truecasing.
  {
    text: 'my name is ali hassan and my phone number is 888999000',
    sensitive: ['ali hassan', '888999000'],
    keep: ['my name is', 'phone number'],
  },
  {
    text: 'please write an email to sarah johnson about the contract renewal',
    sensitive: ['sarah johnson'],
    keep: ['write an email', 'contract renewal'],
  },
  {
    text: 'can you help me reply to omar? he wants the report by thursday',
    sensitive: ['omar'],
    keep: ['reply to', 'the report'],
  },
  {
    text: 'i met john yesterday and he said the meeting is moved',
    sensitive: ['john'],
    keep: ['yesterday', 'meeting is moved'],
  },
  {
    text: 'ask fatima ahmed to send the signed invoice to the baghdad office',
    sensitive: ['fatima ahmed', 'baghdad'],
    keep: ['signed invoice'],
  },
  // Lowercase tech words and chat shorthand are rare words too, but no one.
  { text: 'fix this python script, it reads a json file and fails after npm install', sensitive: [], keep: ['python script', 'json file', 'npm install'] },
  { text: 'deploy the app to kubernetes and check the logs in grafana', sensitive: [], keep: ['kubernetes', 'grafana'] },
  { text: 'run docker compose up, then open postgres', sensitive: [], keep: ['docker compose', 'postgres'] },
  { text: 'thx, pls summarize this todo list lol', sensitive: [], keep: ['thx', 'pls', 'todo list', 'lol'] },
  // Name-free prompts that start the same way: nothing should be replaced.
  { text: 'Call the vendor tomorrow and confirm the delivery window.', sensitive: [], keep: ['Call the vendor', 'delivery window'] },
  { text: 'Email the finance team the updated budget spreadsheet.', sensitive: [], keep: ['Email the finance team', 'budget spreadsheet'] },
  { text: 'Review this pull request and summarize the main risks.', sensitive: [], keep: ['Review this pull request', 'main risks'] },
  { text: 'Translate the onboarding guide into Spanish and French.', sensitive: [], keep: ['onboarding guide', 'Spanish', 'French'] },
  { text: 'Write a cover letter for a project manager role in healthcare.', sensitive: [], keep: ['cover letter', 'project manager', 'healthcare'] },
  { text: 'Summarize the meeting notes and list action items by owner.', sensitive: [], keep: ['meeting notes', 'action items'] },
];
