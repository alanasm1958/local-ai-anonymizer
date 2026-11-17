# Detection test report: MENA stress suite

Dates: built and first run 2026-11-07, fixes 2026-11-08.

Branch: `test/full-detection-suite`, made from `ci/windows-macos` with its uncommitted work. **Nothing is committed yet.**

## Scope used

Alan asked for the suite to be built before confirming each scope answer, so the recommended answers were used. They live in `tests/stress/policy.js` and can be flipped there.

- **Audience:** Amideast staff across the Middle East and North Africa (14 countries in the test: EG, JO, LB, PS, MA, TN, YE, KW, AE, IQ, SA, OM, QA, BH).
- **Must catch:**
  - names in Latin letters in every casing, and a lone first name when capitalized,
  - phones in every regional format, including Arabic-Indic, Persian and full-width digits,
  - IDs after a keyword, in any casing,
  - IBAN, cards, date of birth, email, keys and IPs,
  - Western addresses, organizations and places.
- **Known gaps** (measured, not counted as failures):
  - names in Arabic script,
  - regional addresses,
  - a lone lowercase first name,
  - a name split across two lines,
  - an ID with no keyword,
  - a phone number written in words,
  - "x at y dot com" emails,
  - a bare 6-digit local number with no phone word.
- **When unsure:** hide it. So invoice-like numbers are reported, not failed.

## How the test works

- `tests/stress/` builds the cases from a seeded generator, so every run gets the same cases.
- Each value is tested in:
  - **5 casings:** Title, lower, UPPER, mIxEd, and First-only.
  - **17 places in the text:** sentence positions, after a colon or dash, in brackets and quotes, in a bullet, a markdown table, a CSV row and JSON, in a signature, with no space around it, repeated, after a prompt-injection line, and at the 1,200-character chunk edge of a long paste.
  - **8 copy-paste traps:** non-breaking space, zero-width space, right-to-left marks, tabs, smart quotes, and Arabic-Indic, Persian and full-width digits.
- **Phones** come from each country's numbering plan, in 12 to 14 formats each. **IBANs** have valid check digits, **cards** pass Luhn, and **keys** are generated at run time.
- **The leak check is strict** (`tests/stress/oracle.js`, with 11 tests of its own):
  - any name word that survives is a leak ("[PERSON_1] Haddad" is a leak),
  - so is any 4 digits in a row from a number,
  - casing, digit script and invisible characters are ignored when checking.
- **Every case is also run twice** (it must give the same output both times) and **restored** (it must give back the exact input).
- **Run it:** `npm run stress` (about 30 seconds). Output goes to `stress-<date>.csv` (every case) and `.json` (summary and failures).

## Results: before and after the fixes

The set grew from 3,475 to 3,498 cases after the fixes: 21 more ordinary sentences that must be left alone (to catch over-eager new rules) and 2 ambiguous numbers.

| | Before | After |
|---|---|---|
| Pass | 2,621 | **3,293** |
| Fail | 668 | **17** |
| Names caught | 83.3% | **99.0%** (1,250 of 1,262) |
| Ordinary sentences hidden by mistake | 0 of 63 | **0 of 84** |
| Same output on a second run, restores exactly | all | all |

| Type | Leaks before | Leaks after |
|---|---|---|
| Phone (833 cases) | 124 | 0 |
| ID after a keyword (258) | 60 | 0 |
| IBAN (66) | 22 | 0 |
| Date of birth (117) | 39 | 0 |
| Western address (90) | 43 | 0 |
| Email (100) | 3 | 0 |
| Organization (100) | 26 | 3 |
| Location (202) | 12 | 1 |
| Names (1,262) | 211 | 12 |
| Card, key, IP (198) | 0 | 0 |

**Other suites after the fixes:**
- 246 unit tests pass, including 35 new ones for these rules.
- Lint is clean.
- The old eval: 99.0% caught, 100% of safe phrases kept.
- The 47 text scenarios all pass.
- Browser suite: 90 of 90 pass, run on the final code with the real extension in Chromium.

## What was fixed

1. **Digits and invisible characters** (`src/core/normalize.js`). Rules and model now read a copy with plain digits and no zero-width or right-to-left characters. Results are mapped back onto the original text, so restore is still exact. This closed every Arabic-Indic, Persian and full-width digit leak, and the zero-width leaks.
2. **Phone number plans for 18 MENA countries** (`src/core/phone-plans.js`). This is the exact-check step of the number design.
   - A number that fits a country's plan counts as a phone in any spacing: local, `+cc`, `00cc` or `+cc (0)`.
   - That closed the 8-digit Lebanon, Gulf and Tunisia numbers and the 1-digit groups ("+961 3 54 6390").
   - "555-1234" counts. So do 6 digits right after a phone word, in English or Arabic (رقم الهاتف).
   - IP addresses and dates never count.
3. **IDs:**
   - new keywords: CIN, iqama, civil ID, national number, and the Arabic ones (الرقم القومي, رقم الهوية, الرقم المدني, جواز السفر...),
   - lowercase IDs ("passport no a39573324"), with a shape rule so "python3" and "handbook2024" still pass through.
4. **IBAN in any case**, plus **dates of birth** like "15-Jan-1978", after تاريخ الميلاد, or in quotes.
5. **Street addresses in any case.** Everyday words rule out prose that reads like an address ("3 kids on the road").
6. **Names** (`src/core/name-parts.js`, `truecase.js`, `ner.js`):
   - the model files some unfamiliar names under a fourth label (MISC), which the extension used to ignore; two or more unknown capitalized words there now count as a person,
   - a surname or first name next to a found name joins it, and so do "Surname, First", "Al-"/"El-" particles and initials,
   - table `|` characters are hidden from the model, because they made it misread names,
   - ALL CAPS tables are truecased as a whole,
   - accented capitals ("BÊRIVAN") and runs of capital words inside a normal sentence are lowered for the model,
   - "gEoRgEs" style casing is undone,
   - exam names (toefl, ielts) stay as typed.
7. **Companies:** a place followed by a company word ("Nile valley trading co.") becomes one organization.

## Independent code review

A separate reviewer ran adversarial inputs against the new code. It confirmed:
- no regex slowdowns (100,000-character hostile inputs finish in under 200 ms),
- exact restore with invisible characters.

It found four real problems, now fixed and covered by tests:

1. **Two phone numbers joined by "/" or "-"** ("07701234567/07801234567") leaked one of them. This was a regression in this round. Both are now found.
2. **The "Surname, First" join swallowed the next word.** "Thanks Sarah, I'll ask" hid "Sarah, I'll", and "Ask Sarah, Ahmed" merged two people. Now a name only joins across a comma when the pair stands alone. Otherwise the second word becomes a separate person, and pronouns never join.
3. **Year ranges and round amounts** ("2019-2024", "5000 6000", "1999 2000 2001") were hidden as Gulf phone numbers. They are now excluded. "call 5512 3456" still counts.
4. **A name first pasted with an invisible character** wasn't recognized in later pastes. It is now.

I also added regional greetings ("Ramadan Kareem", "Inshallah", "Eid Mubarak"...) to the list of words never hidden. The model read "Ramadan Kareem" as a person at 0.99.

Smaller findings left as they are, since they behave the same as before this round:
- a number glued to letters ("Tel0501234567"),
- "(+961) 03 123 456" leaving the bracketed code,
- ". " lost after "Prof.",
- "Docker Compose" hidden as a name.

## The 17 cases still failing

- **11: a lone first name in a table cell, JSON value or bullet** ("| Contact | Karim |"). The model scores these 0.3 to 0.5. Lowering the bar further would start hiding ordinary rare words in lowercase chat.
- **3: a lowercase company name with no company word** ("carthage textiles", "gulf bridge holding").
- **1: "Hawler" in smart quotes inside JSON.**
- **1: "A. El-Sayed" in a signature.** The model's score is 0.447, just under the 0.45 bar.
- **1: the word "OWNER" in an ALL CAPS line,** hidden as an organization.

## Known gaps measured

| Gap | Still missed | Now caught |
|---|---|---|
| Arabic-script names | 36 | 0 |
| Regional addresses | 16 | 20 |
| Lone lowercase first name | 6 | 45 |
| Name split across lines | 0 | 10 |
| ID with no keyword | 14 | 14 |
| Phone in words | 6 | 0 |
| Obfuscated email | 7 | 2 |

## Changed in the test itself (so the numbers stay honest)

- **Grouping of 6-digit numbers.** The generator grouped 6-digit subscriber numbers unrealistically ("03 54 6390"). They now use real 3/3 grouping.
- **"Program Office" no longer has to stay.** It was on the must-keep list for the signature context, and the model reads a unit name on its own line as an organization. Hiding it is allowed under "hide when unsure".
- **A bare 6-digit local number with no phone word** is now a known gap. Without context it reads like any number.

## Live check in Chrome (2026-11-08)

The real extension was loaded unpacked in Alan's Chrome. Each case was a real keyboard paste (clipboard plus Cmd+V) into the message box, and the box was read back after each paste. **Nothing was sent**, and ChatGPT ran in a temporary chat.

| Site | Cases | Leaks |
|---|---|---|
| ChatGPT | 12 | 0 |
| Claude.ai | 6 | 0 |
| Gemini (Quill editor) | 6 | 0 |

The cases covered:
- a phone number in Arabic-Indic digits, a CIN, and a lowercase "el-" name,
- an ALL CAPS markdown table with Gulf and Lebanese numbers,
- a CSV with a civil ID and a Moroccan number,
- mIxEd-case names with a lowercase IBAN,
- Persian digits next to an email containing a zero-width space,
- a signature with "A. El-Sayed",
- "Layla, Zaid" and "Odeh, Tareq",
- Arabic ID, date of birth and phone keywords,
- two phone numbers joined by "/",
- addresses in lower and ALL CAPS.

The ordinary sentence ("TOEFL iBT", "2024-2025", "EGP 1,250", "Ramadan Kareem", "3 hours down the road") came through untouched on all three sites.

**Found live, now fixed:**
- The keyword "CIN" in a CSV row was hidden as a person. Because the vault reuses saved values, it was then hidden in every later paste of the session.
- ID keywords (CIN, iqama, civil ID, Emirates ID...) and "Emirates" alone are now on the never-hide list, with a stress case and a unit test.
- This fix is not in Chrome yet. The extension needs another reload.

**Test-tool trap:** macOS `pbcopy` without a UTF-8 locale turns Arabic digits into garbage ("Ÿ†ŸßŸß"), so the first live paste tested nothing. Copy with `LANG=en_US.UTF-8`.

## Second round of fixes (2026-11-08)

Alan asked for fixes to everything found so far. The stress suite went from **17 to 4 failures** of 3,501 cases, with no ordinary sentence hidden. Names are now **1,260 of 1,262 (99.8%)** caught, and organizations **100 of 100**.

| Issue | Fix |
|---|---|
| Lone first name in a table cell or JSON value ("\| Contact \| Karim \|", `"contact": "Shilan"`, "assigned:Aras") | A proper noun right after a person label (name, contact, owner, student, applicant, assigned...) is a person, however unsure the model is. A person the model already found there is confirmed as is ("Sonia Ben Salah"). |
| Lowercase company with no model tag ("our partner carthage textiles") | Up to three words ending in a company word, with at least one proper noun, is an organization. A company word now confirms a weak tag. |
| Phone word glued to the number ("Tel0501234567", "phone_0501234567", "mob.0501234567") | Caught. |
| Bracketed country code ("(+961) 03 123 456") | The code is part of the number now. |
| ". " lost after "Prof." and "Eng." | A name never starts on the dot of a title. |
| Curly quotes around a name | The model reads straight quotes instead (same length). |
| "Docker Compose", "WhatsApp", "Google Drive" and other tools hidden as names | Added to the never-hide list. |
| "CIN" (found live) and other ID keywords hidden as names | Added to the never-hide list. |

**Still failing (4):**
- "send the agenda to Tareq" in a bullet. There is no label, and the model is unsure.
- "A. El-Sayed" in a signature (score 0.447, bar 0.45).
- "Hawler" in curly quotes inside JSON.
- "OWNER" in an ALL CAPS line, hidden as an organization.

**Other suites:** 250 unit tests, 90 browser tests, all 47 scenarios and the eval (99.0% caught, 100% of safe phrases kept) all pass.

## Not done yet

- **Layer 2:** the stress cases through the real extension in Chromium (paste, drop, typing and send, shortcut, right-click).
- **Layer 3:** files.
- **Layer 4:** live sites.

The existing browser suite (90 tests) re-checks delivery for the current rules.

## For Alan to decide

1. Arabic-script names: 0 of 36 caught. This needs a multilingual model or an Arabic name list, and it's a product decision.
2. Whether a lone first name in a table cell must be caught. Today: 11 misses.
3. Committing this work. Nothing is committed, and it sits on top of the earlier uncommitted work from `ci/windows-macos`.

## Live re-check of the second round of fixes (2026-11-10)

The extension was reloaded in Alan's Chrome at commit 920e65b. Every case was a real keyboard paste. The box was read back after each paste and **nothing was sent**. ChatGPT ran in a temporary chat. Each case ran on its own on ChatGPT, and all five ran as one paste on Claude.ai and Gemini.

| Case | ChatGPT | Claude.ai | Gemini |
|---|---|---|---|
| Lone first names after a label (table cell, JSON, `assigned:`) | pass | pass | pass |
| Lowercase company names ("carthage textiles", "nile valley trading co.") | pass | pass | pass |
| Phone stuck to a word (Tel0501..., phone_..., mob....) and "(+961) 03 123 456" | pass | pass | pass |
| CSV with a CIN column, "Prof."/"Eng." titles, curly quotes | pass, no leak | pass, no leak | pass, no leak |
| Ordinary sentence (Docker Compose, WhatsApp, TOEFL iBT, EGP 1,250) | unchanged | unchanged | unchanged |

**No leaks.** "CIN" now stays visible, which fixes the live bug from 2026-11-08. All three sites gave the same output.

**Wrong labels, nothing leaked (the same output comes from Node via `scripts/ner-debug.mjs`):**
- "BK123456" under a CIN header is hidden as `[PERSON_n]`, not as an ID. The model tags "BK" as an organization at a low score.
- "Rabat" in the same CSV row is hidden as a person (B-PER 0.89), not a place.
- "Eng. Samir Haddad" becomes `[PERSON_n]` with the title inside the placeholder. The word piece "##g" is tagged B-PER at 0.53. "Prof." stays outside.

**Fixed the same day (all three, in Node with the real model; Chrome needs a reload to get them):**
- "BK123456" is now `[ID_NUMBER_n]`: cells under an ID header (CIN, passport, civil ID...) are IDs (`columns.js`, commit fb3733e).
- "Eng." stays visible: regional titles (Eng., Sheikh, Hajj, Ustaz, Kak, H.E.) never join a name (commit fb3733e).
- "Rabat" is now `[LOCATION_n]`: a person or company the model finds in a city, country or location column is labelled a place, including values saved earlier in the session. This only changes the label and never hides more text.

Unit tests 258/258, scenarios 47/47, stress 3,309 pass with the same 4 known failures, lint clean.

**Test-tool trap:** the clipboard was overwritten between the copy and the paste once (a second session was pasting at the same time). Read `pbpaste` right before pasting, and run one live-test session at a time.

## Live typing check and third round of fixes (2026-11-10)

**Typed text, live on ChatGPT.**
- What was typed (temporary chat): "please email hiba zaqout at hiba.z@gmail.com, mobile 0770 123 4567, CIN BE467059".
- Alan then pressed Option+Shift+A.
- The box became "please email [PERSON_1] at [EMAIL_1], mobile [PHONE_1], CIN [ID_NUMBER_1]". No leak, and nothing was sent.
- Claude's browser tool can't press Chrome extension shortcuts (Chrome handles them, and the page only gets the letter), so this step needs a person.
- Cleaning on Enter or Send is left to the fake-page browser tests, because a live test would send a message.

**Found while re-checking the wrong labels, now fixed:**
1. **Leak:** a CSV with a "cin" column and two rows sent the second row's number ("AB654321") as typed. Values under a column header that names IDs or phones (cin, passport, civil ID, iqama, phone, mobile, رقم الهاتف...) are now IDs or phones in CSV, TSV and markdown tables (`src/core/columns.js`, 5 tests).
2. **Titles:** "Contact Eng. Samir Haddad" hid "Eng" as its own person. "Signed: Eng. Samir Haddad" put the title inside the placeholder. Regional titles (Eng., Sheikh, Hajj, Ustaz, Kak, H.E.) are now never part of a name.

**Still a wrong label, no leak:** a lone first name under a "Name" column header can be hidden as an organization ("| Rania | 5512 3456 |").

**Suites:** 256 unit tests, 90 browser tests, all 47 scenarios, the eval (99.0% caught, 100% of safe phrases kept) and the stress suite (3,309 pass, 4 fail) all pass.

## Tables in attached files, live on ChatGPT (2026-11-10)

Alan asked for a table in an attached file. The test files hold the same fake table (names in three casings, CIN, Moroccan and Lebanese phones, emails, cities) as .csv, .xlsx (openpyxl) and .docx (python-docx). Each was attached in a ChatGPT temporary chat through the "Attach files" input, and **no message was sent**. The file ChatGPT's own change handler received was captured in the page and unzipped to read every part.

| File | Live result | With a fresh vault (Node, real model) before the fix |
|---|---|---|
| CSV | all 15 values hidden | all hidden |
| Excel | all hidden, cities labelled person/company | **3 CINs leaked**, Rabat and Fes leaked |
| Word | all hidden, cities labelled person/company | **3 CINs leaked**, plus "HADDAD" and "Beirut" |

**The live Office results only looked clean because the vault held the CSV values from the upload a minute earlier.** Office text reached detection one cell per line, so the "CIN" header lost its column and the model saw names without their rows.

**Fixed:**
- Word and PowerPoint tables and inline Excel cells are read as rows of tab-separated cells, like a TSV (`ooxml.js`).
- Excel shared strings (how Excel stores text) are laid out in sheet order (`xlsx-grid.js`).
- A cell under a city, country or similar header is hidden as a place even when the model is unsure ("Rabat" was LOC 0.50 in a tab row, under the 0.6 bar). Filler like "n/a" or "Remote" stays.

After the fix, all three files come out with every value hidden and a fresh vault. Unit tests 266/266, browser tests 90/90, scenarios 47/47, stress 3,309 pass with the same 4 known failures, lint clean. Still to do: a live re-check after the extension is reloaded.
