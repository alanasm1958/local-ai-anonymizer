// People, organizations, places and emails across the Middle East and North
// Africa. All fake: common given names and family names put together at random.

export const NAMES_BY_COUNTRY = Object.freeze({
  EG: ['Mohamed Abdelrahman', 'Ahmed El-Sayed', 'Mona Abdel Aziz', 'Youssef Mahmoud', 'Nourhan Fathy'],
  JO: ['Rania Haddad', 'Omar Al-Khatib', 'Lina Qasem', 'Tareq Odeh'],
  LB: ['Karim Nassar', 'Maya Khoury', 'Georges Abi Nader', 'Rita Saade'],
  PS: ['Samer Barghouti', 'Hiba Zaqout', 'Yousef Abu Hammad'],
  MA: ['Youssef Benali', 'Fatima Zahra Ouazzani', 'Hicham El Idrissi', 'Salma Bennani'],
  TN: ['Amine Trabelsi', 'Sonia Ben Salah', 'Khaled Jaziri'],
  YE: ['Abdullah Al-Hamdani', 'Arwa Saleh'],
  KW: ['Noura Al-Sabah', 'Bader Al-Mutairi'],
  AE: ['Mariam Al-Mansoori', 'Saeed Al-Ketbi'],
  SA: ['Fahad Al-Otaibi', 'Reem Al-Qahtani'],
  QA: ['Khalid Al-Kuwari'],
  BH: ['Hamad Al-Khalifa'],
  OM: ['Salim Al-Busaidi'],
  IQ: ['Ahmed Karim', 'Zainab Hussein', 'Mustafa Abdulrahman'],
  KRD: ['Hawre Mahmood', 'Shilan Rasul', 'Bêrivan Omer', 'Aras Qadir'],
});

export const FULL_NAMES = Object.freeze(Object.values(NAMES_BY_COUNTRY).flat());

// Names whose first name is also a plain word, used with a title.
export const WORD_NAMES = Object.freeze(['Amal Fawzi', 'Noor Salih', 'Sabah Jaber', 'Hope Daniels', 'Will Turner']);

export const TITLES = Object.freeze(['Dr.', 'Eng.', 'Mr.', 'Mrs.', 'Ms.', 'Prof.', 'Sheikh', 'H.E.', 'Hajj', 'Ustaz', 'Kak']);

export const ARABIC_SCRIPT_NAMES = Object.freeze([
  'محمد عبد الرحمن', 'ليلى منصور', 'يوسف بن علي', 'فاطمة الزهراء العلوي', 'هاوري محمود', 'رانيا حداد',
]);

export const ORGS = Object.freeze([
  'Nile Valley Trading Co.', 'Petra Logistics Ltd', 'Atlas Consulting SARL', 'Gulf Bridge Holding',
  'Cedar Systems SAL', 'Al-Noor Engineering Group', 'Carthage Textiles', 'Saba Pharma LLC',
  'Zagros Construction Company', 'Dilmun Capital', 'Corniche Media Group',
]);

export const LOCATIONS = Object.freeze([
  'Cairo', 'Alexandria', 'Giza', 'Amman', 'Irbid', 'Zarqa', 'Beirut', 'Tripoli', 'Ramallah', 'Nablus',
  'Casablanca', 'Rabat', 'Marrakech', 'Tunis', 'Sfax', 'Sanaa', 'Aden', 'Dubai', 'Abu Dhabi', 'Sharjah',
  'Baghdad', 'Erbil', 'Basra', 'Sulaymaniyah', 'Duhok', 'Riyadh', 'Jeddah', 'Muscat', 'Doha', 'Manama',
  'Salmiya', 'Hawler', 'Slemani', 'Ankawa',
]);

export const EMAILS = Object.freeze([
  'rania.haddad@gmail.com', 'm.abdelrahman@aucegypt.edu', 'y.benali@um5.ac.ma', 'KHALID.ALKUWARI@QU.EDU.QA',
  'noura+jobs@gmail.com', 'hawre.mahmood@uokurdistan.edu.krd', 'amine_trabelsi87@yahoo.fr',
  'Fahad.AlOtaibi@company.com.sa', 'shilan.rasul@outlook.com', 'karim.nassar@cedar-systems.com.lb',
]);

export const OBFUSCATED_EMAILS = Object.freeze([
  'rania dot haddad at gmail dot com', 'youssef.benali [at] gmail [dot] com', 'samer(at)barghouti.ps',
]);

// Lone first names and name shapes built from the lists above.
export const firstName = (full) => full.split(' ')[0];
export const lastName = (full) => full.split(' ').slice(1).join(' ');
