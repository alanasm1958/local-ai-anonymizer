// The 50-case scenario package: every kind of name, data and format the
// extension promises to handle, and every way text or files reach a site.
// Shared by scripts/scenarios.mjs (pipeline in Node, real model) and
// tests/e2e/scenarios.e2e.js (real extension in Chromium).
//
// remove:    must not survive, matched as whole words, case-sensitive.
// keep:      must survive unchanged (catches over-redaction).
// knownMiss: items a documented limitation may leave; reported, not failed.
// known:     the whole case is a documented gap; reported, not failed.
// onePlaceholder: every spelling in the text must share one placeholder.
// channel:   how the browser runner delivers it (see CHANNELS below).

export const CHANNELS = Object.freeze({
  'paste-textarea': 'Paste into a textarea',
  'paste-rich': 'Paste into an editor with its own paste handler (ProseMirror-like)',
  'paste-bare': 'Paste into a bare contenteditable',
  'paste-page': 'Paste outside any text box (page-wide handler)',
  'paste-shadow': 'Paste into a textarea inside a shadow root',
  'paste-html': 'Paste rich text only (text/html, no text/plain)',
  drop: 'Drag text into a text box',
  'type-enter': 'Type with the keyboard, then press Enter',
  'type-shortcut': 'Type, then Alt+Shift+A',
  selection: 'Type, select part, then right-click Anonymize selection',
  upload: 'Pick text files with the file picker',
  'upload-office': 'Pick Office files with the file picker',
  held: 'Pick files that cannot be checked',
  reveal: 'Paste, then see the reply with real values',
});

const LONG_FILLER = 'The quarterly review covered hiring, budgets and the office move. '.repeat(30);

export const CASES = Object.freeze([
  // ---- Names: casing and shapes ----
  {
    id: 'S01', group: 'names', channel: 'paste-textarea', title: 'Full name, normal capitalization',
    text: 'Please draft a thank-you note to Layla Mansour for hosting the workshop.',
    remove: ['Layla', 'Mansour'], keep: ['thank-you note', 'workshop'],
  },
  {
    id: 'S02', group: 'names', channel: 'paste-rich', title: 'Full name, all lowercase',
    text: 'please draft a thank-you note to layla mansour for hosting the workshop',
    remove: ['layla', 'mansour'], keep: ['thank-you note', 'workshop'],
  },
  {
    id: 'S03', group: 'names', channel: 'paste-bare', title: 'Full name, ALL CAPS',
    text: 'PLEASE DRAFT A THANK-YOU NOTE TO LAYLA MANSOUR FOR HOSTING THE WORKSHOP',
    remove: ['LAYLA', 'MANSOUR'], keep: ['THANK-YOU NOTE', 'WORKSHOP'],
  },
  {
    id: 'S04', group: 'names', channel: 'paste-page', title: 'Mixed and sloppy casing, hyphenated surname',
    text: 'pls email AHMED al-rashid and Sarah whitfield about the audit',
    remove: ['AHMED', 'al-rashid', 'Sarah', 'whitfield'], keep: ['audit'],
  },
  {
    id: 'S05', group: 'names', channel: 'paste-textarea', title: 'Lone lowercase first name in chat',
    text: 'can you check if omar replied to my message',
    remove: ['omar'], keep: ['replied to my message'],
  },
  {
    id: 'S06', group: 'names', channel: 'paste-rich', title: 'Titles and initials',
    text: 'Dr. J. R. Okafor will chair the panel; Prof. Mei Lin will second the motion.',
    remove: ['Okafor', 'Mei', 'Lin'], keep: ['chair the panel', 'second the motion'],
  },
  {
    id: 'S07', group: 'names', channel: 'paste-bare', title: 'Names that are also everyday words',
    text: 'Will Smith and Grace Park met on 3 May. I will hope for grace and a good park.',
    remove: ['Smith', 'Grace Park'], keep: ['I will hope for grace', 'a good park'],
  },
  {
    id: 'S08', group: 'names', channel: 'paste-textarea', title: 'Arabic-origin multi-part names and an Iraqi company',
    text: 'Hussein Ali Al-Jaburi and Zainab bint Khalid joined Basra Oil Company last spring.',
    remove: ['Hussein', 'Al-Jaburi', 'Zainab', 'Khalid', 'Basra Oil Company'], keep: ['last spring'],
  },
  {
    id: 'S09', group: 'names', channel: 'paste-rich', title: 'Apostrophes and accented letters',
    text: "Siobhán O'Sullivan and José Ñúñez reviewed the grant proposal.",
    remove: ['Siobhán', "O'Sullivan", 'José', 'Ñúñez'], keep: ['grant proposal'],
  },
  {
    id: 'S10', group: 'names', channel: 'paste-bare', title: 'Repeated mentions, possessive, lowercase',
    text: "ask sarah whitfield for the file. sarah's report is late and whitfield knows why.",
    remove: ['sarah', 'whitfield'], keep: ['report is late'],
  },
  {
    id: 'S11', group: 'names', channel: 'paste-textarea', title: 'Name in Arabic script (model is English-only)',
    text: 'اسمي علي حسن ورقم هاتفي 07701234567',
    remove: ['07701234567'], knownMiss: ['علي', 'حسن'],
  },
  {
    id: 'S12', group: 'names', channel: 'paste-page', title: 'Greeting and email signature block',
    text: 'Hi Fatou,\nThanks for the update!\n--\nDaniel Okoro\nSenior Analyst, Ecobank\n+234 803 555 0199',
    remove: ['Fatou', 'Daniel', 'Okoro', 'Ecobank', '+234 803 555 0199'], keep: ['Senior Analyst', 'Thanks for the update'],
  },

  // ---- Structured data ----
  {
    id: 'S13', group: 'data', channel: 'paste-textarea', title: 'Email addresses, any case',
    text: 'Contact maria.gonzalez@northwind.example or MARIA@NORTHWIND.EXAMPLE today.',
    remove: ['maria.gonzalez@northwind.example', 'MARIA@NORTHWIND.EXAMPLE'], keep: ['today'],
  },
  {
    id: 'S14', group: 'data', channel: 'paste-rich', title: 'Phone numbers in many formats',
    text: 'Reach me on +964 770 123 4567, (415) 555-0132, 0770-123-4567 or my phone is 888999000.',
    remove: ['+964 770 123 4567', '(415) 555-0132', '0770-123-4567', '888999000'], keep: ['Reach me on'],
  },
  {
    id: 'S15', group: 'data', channel: 'paste-bare', title: 'Card number and IBAN',
    text: 'Card 4111 1111 1111 1111 exp 12/27, IBAN GB82 WEST 1234 5698 7654 32.',
    remove: ['4111 1111 1111 1111', 'GB82 WEST 1234 5698 7654 32'], keep: ['exp 12/27'],
  },
  {
    id: 'S16', group: 'data', channel: 'paste-textarea', title: 'API keys and passwords',
    text: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456 and password: Hunter2pass!',
    remove: ['sk-proj-abcdefghijklmnopqrstuvwxyz123456', 'Hunter2pass!'], keep: ['OPENAI_API_KEY='],
  },
  {
    id: 'S17', group: 'data', channel: 'paste-rich', title: 'IP addresses and internal URLs',
    text: 'Server 10.0.12.7 and fe80::1ff:fe23:4567:890a, dashboard https://internal.acme.example/admin?id=7',
    // URLs are off by default (Settings > Web links), so the link may stay.
    remove: ['10.0.12.7', 'fe80::1ff:fe23:4567:890a'], knownMiss: ['https://internal.acme.example/admin?id=7'], keep: ['Server', 'dashboard'],
  },
  {
    id: 'S18', group: 'data', channel: 'paste-bare', title: 'Passport, date of birth, employee ID',
    text: 'Passport no. A12345678, DOB: 14/02/1990, employee ID EMP-55821.',
    remove: ['A12345678', '14/02/1990', 'EMP-55821'], keep: ['Passport no.'],
  },
  {
    id: 'S19', group: 'data', channel: 'paste-page', title: 'Street address and postcode',
    text: 'Ship it to 221B Baker Street, London NW1 6XE by Monday.',
    remove: ['221B Baker Street', 'NW1 6XE'], keep: ['by Monday'],
  },
  {
    id: 'S20', group: 'data', channel: 'paste-textarea', title: 'US social security number',
    text: 'Her SSN is 123-45-6789 and she starts in March.',
    remove: ['123-45-6789'], keep: ['starts in March'],
  },
  {
    id: 'S21', group: 'data', channel: 'paste-rich', title: 'Numbers that are not personal data',
    text: 'Revenue was 888999000 IQD in 2025; order 12345 shipped on 2026-10-24 at 10:30.',
    remove: [], keep: ['888999000', '12345', '2026-10-24', '10:30'],
  },
  {
    id: 'S22', group: 'data', channel: 'paste-bare', title: 'Everything in one paragraph',
    text: 'Yusuf Demir (yusuf.demir@anadolu.example, +90 532 555 0101) from Anadolu Bank paid with 5500 0000 0000 0004 from 192.168.1.20.',
    remove: ['Yusuf', 'Demir', 'yusuf.demir@anadolu.example', '+90 532 555 0101', 'Anadolu Bank', '5500 0000 0000 0004', '192.168.1.20'],
    keep: ['paid with'],
  },

  // ---- Formats ----
  {
    id: 'S23', group: 'formats', channel: 'paste-textarea', title: 'Markdown table, mixed casing (found live on ChatGPT)',
    text: 'Turn this table into a short summary:\n| Name | Email | Phone |\n|---|---|---|\n| Ali Hassan | ali@corp.example | 0770 123 4567 |\n| sarah johnson | s.j@corp.example | +1 415 555 0132 |\n| OMAR FAROUK | omar@farouk.example | +964 750 123 4567 |',
    remove: ['Ali', 'Hassan', 'ali@corp.example', '0770 123 4567', 'sarah', 'johnson', 's.j@corp.example', '+1 415 555 0132', 'OMAR', 'FAROUK', 'omar@farouk.example', '+964 750 123 4567'],
    keep: ['| Name | Email | Phone |', '|---|---|---|'],
  },
  {
    id: 'S24', group: 'formats', channel: 'paste-rich', title: 'CSV rows after a plain line (found live on ChatGPT)',
    text: 'Count the rows in this CSV:\nname,email,city\nWei Zhang,wei@x.example,Shenzhen\nfatima ahmed,fatima@x.example,baghdad\nKLAUS RICHTER,k.richter@example.de,Berlin',
    remove: ['Wei', 'Zhang', 'wei@x.example', 'Shenzhen', 'fatima', 'ahmed', 'fatima@x.example', 'baghdad', 'KLAUS', 'RICHTER', 'k.richter@example.de', 'Berlin'],
    keep: ['name,email,city'],
  },
  {
    id: 'S25', group: 'formats', channel: 'paste-bare', title: 'JSON object with a huge number',
    text: '{"customer": {"name": "Klaus Richter", "email": "k.richter@example.de", "phone": "+49 30 1234567"}, "amount": 12345678901234567890}',
    remove: ['Klaus', 'Richter', 'k.richter@example.de', '+49 30 1234567'], keep: ['"customer"', '12345678901234567890'],
  },
  {
    id: 'S26', group: 'formats', channel: 'paste-textarea', title: 'Code block',
    text: "```python\nuser = {'name': 'Elena Petrova', 'email': 'elena@corp.example'}\nprint(user['name'])\n```",
    remove: ['Elena', 'Petrova', 'elena@corp.example'], keep: ["print(user['name'])", '```python'],
  },
  {
    id: 'S27', group: 'formats', channel: 'paste-rich', title: 'Mermaid diagram',
    text: '```mermaid\ngraph TD\n  A[Rachel Goldberg] -->|approves| B[Finance: Marcus Bell]\n  B --> C[Sterling Check Ltd]\n```',
    remove: ['Rachel', 'Goldberg', 'Marcus', 'Bell', 'Sterling Check Ltd'], keep: ['graph TD', '-->|approves|'],
  },
  {
    id: 'S28', group: 'formats', channel: 'paste-bare', title: 'ASCII org chart, lowercase name',
    text: '+--------------------------+\n| CEO: Jamal Washington    |\n+--------------------------+\n             |\n      CTO: ingrid solberg',
    remove: ['Jamal', 'Washington', 'ingrid', 'solberg'], keep: ['CEO:', 'CTO:', '+--------------------------+'],
  },
  {
    id: 'S29', group: 'formats', channel: 'paste-page', title: 'Markdown headings, bullets, bold and italics',
    text: '## Attendees\n- Yusuf Demir (Anadolu Bank)\n- **Hannah Becker**, Siemens Energy\n- _robert kim_',
    remove: ['Yusuf', 'Demir', 'Anadolu Bank', 'Hannah', 'Becker', 'Siemens Energy', 'robert', 'kim'], keep: ['## Attendees'],
  },
  {
    id: 'S30', group: 'formats', channel: 'paste-textarea', title: 'Forwarded email headers',
    text: 'From: Diego Fernández <diego@ventas.example>\nTo: Sofia Rossi <sofia.rossi@ferrero.example>\nSubject: Re: Q3 forecast\n\nHi Sofia, see attached.',
    remove: ['Diego', 'Fernández', 'diego@ventas.example', 'Sofia', 'Rossi', 'sofia.rossi@ferrero.example'],
    keep: ['Subject: Re: Q3 forecast', 'see attached'],
  },
  {
    id: 'S31', group: 'formats', channel: 'paste-html', title: 'Rich-text table copied from a web page or Word',
    text: 'Aisha Bello aisha@unilag.example University of Lagos',
    html: '<table><tr><th>Name</th><th>Email</th></tr><tr><td>Aisha Bello</td><td>aisha@unilag.example</td></tr><tr><td colspan="2">University of Lagos</td></tr></table>',
    remove: ['Aisha', 'Bello', 'aisha@unilag.example', 'University of Lagos'], keep: [],
  },
  {
    id: 'S32', group: 'formats', channel: 'paste-rich', title: 'Log lines',
    text: '2026-10-24T10:31:07Z INFO login ok user=james.whitaker@oxford.example ip=192.168.4.20 session=af31c9',
    remove: ['james.whitaker@oxford.example', '192.168.4.20'], keep: ['2026-10-24T10:31:07Z INFO login ok'],
  },
  {
    id: 'S33', group: 'formats', channel: 'paste-bare', title: 'Long document, names after several chunks',
    text: `${LONG_FILLER}Final approver: Olumide Adeyemi, olumide@flutterwave.example.`,
    remove: ['Olumide', 'Adeyemi', 'olumide@flutterwave.example'], keep: ['quarterly review'],
  },
  {
    id: 'S34', group: 'formats', channel: 'paste-textarea', title: 'Chat transcript in lowercase',
    text: 'me: hey can u ask chinedu okafor to send the deck\nbot: sure\nme: also cc gloria mendoza pls',
    remove: ['chinedu', 'okafor', 'gloria', 'mendoza'], keep: ['send the deck', 'pls'],
  },

  // ---- Must stay untouched ----
  {
    id: 'S35', group: 'negatives', channel: 'paste-rich', title: 'Lowercase tech prompt',
    text: 'fix this python script that reads json and writes to postgres running in docker on kubernetes',
    remove: [], keep: ['python', 'json', 'postgres', 'docker', 'kubernetes'],
  },
  {
    id: 'S36', group: 'negatives', channel: 'paste-bare', title: 'Plain business prompt',
    text: 'Summarize the meeting notes and list action items by owner.',
    remove: [], keep: ['Summarize the meeting notes and list action items by owner.'],
  },
  {
    id: 'S37', group: 'negatives', channel: 'paste-page', title: 'Everyday words that are also names',
    text: 'May I mark this bill as paid? I hope it will rain, and grace periods apply.',
    remove: [], keep: ['May I mark this bill as paid?', 'I hope it will rain', 'grace periods'],
  },
  {
    id: 'S38', group: 'negatives', channel: 'paste-textarea', title: 'Text that already contains placeholders',
    text: 'Keep [PERSON_1] as is and explain what [EMAIL_2] means.',
    remove: [], keep: ['[PERSON_1]', '[EMAIL_2]'],
  },
  {
    id: 'S39', group: 'negatives', channel: 'paste-rich', title: 'AI and office product names',
    text: 'Compare ChatGPT, Claude and Gemini for writing Excel formulas in Teams.',
    remove: [], keep: ['ChatGPT', 'Claude', 'Gemini', 'Excel', 'Teams'],
  },
  {
    id: 'S40', group: 'negatives', channel: 'paste-bare', title: 'Dates, money and quarters',
    text: 'Deadline Friday 14 November 2026, budget $48,200, review in Q3.',
    remove: [], keep: ['Friday 14 November 2026', '$48,200', 'Q3'],
  },

  // ---- Channels ----
  {
    id: 'S41', group: 'channels', channel: 'type-enter', title: 'Typed by hand, then Enter (clean on send)',
    text: 'my name is ali hassan and my phone number is 888999000',
    remove: ['ali', 'hassan', '888999000'], keep: ['my name is', 'phone number'],
  },
  {
    id: 'S42', group: 'channels', channel: 'type-shortcut', title: 'Typed, then Alt+Shift+A',
    text: 'my name is ali hassan and my phone number is 888999000',
    remove: ['ali', 'hassan', '888999000'], keep: ['my name is', 'phone number'],
  },
  {
    id: 'S43', group: 'channels', channel: 'selection', title: 'Typed, part selected, right-click Anonymize selection',
    text: 'Keep this intro. Send it to Priya Raman at priya@tcs.example',
    select: 'Priya Raman at priya@tcs.example',
    remove: ['Priya', 'Raman', 'priya@tcs.example'], keep: ['Keep this intro.'],
  },
  {
    id: 'S44', group: 'channels', channel: 'drop', title: 'Text dragged in from another app',
    text: 'Ask Leila Haddad (leila@haddad.example) to sign by Friday.',
    remove: ['Leila', 'Haddad', 'leila@haddad.example'], keep: ['sign by Friday'],
  },
  {
    id: 'S45', group: 'channels', channel: 'paste-shadow', title: 'Paste into a web-component text box',
    text: 'Invoice for Kevin O\'Connor, card 4111 1111 1111 1111.',
    remove: ['Kevin', "O'Connor", '4111 1111 1111 1111'], keep: ['Invoice for'],
  },
  {
    id: 'S46', group: 'channels', channel: 'reveal', title: 'Reply shows real values to the user only',
    text: 'Write a welcome message for Mei Lin, mei.lin@corp.example.',
    remove: ['Mei', 'Lin', 'mei.lin@corp.example'], keep: ['welcome message'],
  },
  {
    id: 'S47', group: 'channels', channel: 'upload', title: 'Text, CSV, JSON and Markdown files',
    files: [
      { name: 'Ali_Hassan_notes.txt', mime: 'text/plain', body: 'Call ali hassan on 0770 123 4567 about the visa.' },
      { name: 'contacts.csv', mime: 'text/csv', body: 'name,email\nWei Zhang,wei@x.example\nsarah johnson,sj@x.example' },
      { name: 'customer.json', mime: 'application/json', body: '{"name": "Klaus Richter", "id": 12345678901234567890}' },
      { name: 'minutes.md', mime: 'text/markdown', body: '# Minutes\n- **Omar Farouk** presented\n- email omar@farouk.example' },
    ],
    remove: ['Ali', 'Hassan', 'ali', 'hassan', '0770 123 4567', 'Wei', 'Zhang', 'wei@x.example', 'sarah', 'johnson', 'sj@x.example', 'Klaus', 'Richter', 'Omar', 'Farouk', 'omar@farouk.example'],
    keep: ['name,email', '12345678901234567890', '# Minutes'],
  },
  {
    id: 'S48', group: 'channels', channel: 'upload-office', title: 'Word, Excel and PowerPoint files',
    fixtures: ['python-docx.docx', 'openpyxl.xlsx', 'python-pptx.pptx'],
    remove: ['Maria', 'Gonzalez', 'maria.gonzalez@northwind.example', 'Northwind Traders', '7946 0958', '4111 1111 1111 1111'],
    knownMiss: ['442079460958'],
  },
  {
    id: 'S49', group: 'channels', channel: 'held', title: 'PDF and image are held, never sent unchecked',
    files: [
      { name: 'scan.pdf', mime: 'application/pdf', body: '%PDF-1.4 Maria Gonzalez' },
      { name: 'passport.png', mime: 'image/png', body: 'PNG-bytes' },
    ],
    remove: [],
  },
  {
    id: 'S50', group: 'channels', channel: 'paste-textarea', title: 'One person in three casings gets one placeholder',
    text: 'Follow up with Omar Farouk. omar farouk said OMAR FAROUK would call.',
    remove: ['Omar', 'Farouk', 'omar', 'farouk', 'OMAR', 'FAROUK'], keep: ['Follow up with', 'would call'], onePlaceholder: true,
  },
]);
