// Addresses and the negative set: ordinary text that must come through intact.

export const WESTERN_ADDRESSES = Object.freeze([
  '221 Baker Street', '1600 Pennsylvania Avenue NW', '10 Downing Street', '42 Wallaby Way, Sydney', '350 Fifth Avenue',
]);

// How addresses are written across the region. Building/block style, P.O.
// boxes, landmarks. Several also look like the Western form ("12 Mecca Street").
export const REGIONAL_ADDRESSES = Object.freeze([
  'Building 5, Street 9, Maadi, Cairo',
  '14 El Tahrir Street, Dokki, Giza',
  '12 Mecca Street, Amman',
  'P.O. Box 1234, Amman 11118',
  'Villa 23, Al Wasl Road, Jumeirah, Dubai',
  'Hamra Street, Bldg 14, 3rd floor, Beirut',
  'Block 3, Street 15, House 22, Salmiya',
  'Apartment 7, 45 Avenue Mohammed V, Rabat',
  '100m Street, near Family Mall, Erbil',
  'Mahalla 913, Zuqaq 4, House 18, Baghdad',
  'Ankawa, behind Saint Joseph Church, Erbil',
  'Rue Ibn Khaldoun 18, Tunis 1002',
]);

// Ordinary text. keep: what must survive exactly. Several look like numbers
// the rules care about on purpose.
export const NEGATIVES = Object.freeze([
  { id: 'price-iqd', text: 'The course fee is IQD 250,000 per student.', keep: ['IQD 250,000'] },
  { id: 'price-egp', text: 'Lunch for the group came to EGP 1,250 in total.', keep: ['EGP 1,250'] },
  { id: 'price-usd', text: 'The license costs $4,999.00 a year.', keep: ['$4,999.00'] },
  { id: 'version', text: 'Upgrade the app to v2.10.3 before Monday.', keep: ['v2.10.3'] },
  { id: 'time', text: 'The session starts at 14:30 and ends at 16:00.', keep: ['14:30', '16:00'] },
  { id: 'plain-date', text: 'The workshop is on 12/03/2025 in the main hall.', keep: ['12/03/2025'] },
  { id: 'iso-date', text: 'Deadline: 2025-11-30 for all submissions.', keep: ['2025-11-30'] },
  { id: 'quantity', text: 'We ordered 250 units and 1,200 brochures.', keep: ['250 units', '1,200 brochures'] },
  { id: 'room', text: 'Interviews will be held in room 204 on the second floor.', keep: ['room 204'] },
  { id: 'percent', text: 'Attendance rose by 37.5% compared to last year.', keep: ['37.5%'] },
  { id: 'year-range', text: 'The program ran from 2019 to 2024 across five cities.', keep: ['2019 to 2024'] },
  { id: 'score', text: 'The minimum TOEFL score is 79 and IELTS is 6.5.', keep: ['TOEFL', '79', '6.5'] },
  { id: 'code', text: 'for (let i = 0; i < 10; i++) { total += i * 2; }', keep: ['for (let i = 0; i < 10; i++)'] },
  { id: 'will-may', text: 'Will you send the agenda? May I add one item?', keep: ['Will you', 'May I'] },
  { id: 'hope-rose', text: 'I hope the rose garden is open in May.', keep: ['hope', 'rose garden', 'May'] },
  { id: 'sabah-word', text: 'The meeting is in the morning, sabah al khair to all.', keep: ['meeting', 'morning'] },
  { id: 'generic-roles', text: 'The manager asked the director to brief the board.', keep: ['manager', 'director', 'board'] },
  { id: 'course-names', text: 'Modules: Business English, Academic Writing, Leadership 101.', keep: ['Business English', 'Academic Writing', 'Leadership 101'] },
  { id: 'english-sentence', text: 'Please summarize the attached notes in three bullet points.', keep: ['summarize the attached notes', 'three bullet points'] },
  { id: 'chat-shorthand', text: 'thx, pls send the json asap and cc the team', keep: ['thx', 'json', 'asap', 'cc the team'] },
  { id: 'road-prose', text: 'We drove 3 hours down the road and back.', keep: ['3 hours down the road'] },
  { id: 'street-prose', text: '2 kids crossed the street near the school.', keep: ['2 kids crossed the street'] },
  { id: 'dotted-version', text: 'Update the server to version 10.24.7 tonight.', keep: ['10.24.7'] },
  { id: 'tool-versions', text: 'Install python3 and node18 before the workshop.', keep: ['python3', 'node18'] },
  { id: 'calendar', text: 'Classes run Sunday to Thursday, January to June.', keep: ['Sunday to Thursday', 'January to June'] },
  { id: 'exams', text: 'Register for the TOEFL iBT, IELTS or the GRE by Friday.', keep: ['TOEFL iBT', 'IELTS', 'GRE'] },
  { id: 'reference-words', text: 'See section 4.2 and table 3 for the case study.', keep: ['section 4.2', 'table 3', 'case study'] },
  { id: 'id-keywords', text: 'Fields: CIN, iqama, civil ID, national ID and Emirates ID.', keep: ['CIN', 'iqama', 'civil ID', 'national ID', 'Emirates ID'] },
  { id: 'percent-table', text: '| Quarter | Growth |\n|---|---|\n| Q1 | 12% |\n| Q2 | 18% |', keep: ['Q1', '12%', 'Q2', '18%'] },
]);

// Numbers that look like phones or IDs but are not. Hiding them is allowed
// (policy: hide when unsure), so they are reported, not failed.
export const AMBIGUOUS_NUMBERS = Object.freeze([
  { id: 'invoice', text: 'Invoice 2024 1103 5567 is still unpaid.', value: '2024 1103 5567' },
  { id: 'order', text: 'Order number 778812349 shipped today.', value: '778812349' },
  { id: 'tracking', text: 'Tracking: 1Z 999 AA1 0123 4567 84', value: '1Z 999 AA1 0123 4567 84' },
  { id: 'reference', text: 'Bank transfer reference 20251107553901.', value: '20251107553901' },
  { id: 'order-8', text: 'Order 50123456 shipped on Monday.', value: '50123456' },
  { id: 'isbn', text: 'ISBN 978-0-19-852663-6 is the course book.', value: '978-0-19-852663-6' },
]);
