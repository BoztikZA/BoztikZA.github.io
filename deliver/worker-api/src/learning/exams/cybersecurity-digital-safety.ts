import type { ExamQuestion } from "../types.ts";

export const questions: ExamQuestion[] = [
  {
    "id": "sec-01",
    "module": "m01",
    "kind": "single",
    "prompt": "Which of these incidents is mainly an attack on availability?",
    "options": [
      "A stranger reads a private conversation in your messaging app",
      "Someone edits the bank account number on a supplier's invoice",
      "A leaked list reveals your customers' ID numbers to the public",
      "Ransomware locks a small business's order files so staff cannot open them"
    ],
    "correct": [
      3
    ],
    "explain": "Availability means you can reach your information when you need it. Locked files stop the business working even if nobody reads or changes them. The other options are confidentiality and integrity problems."
  },
  {
    "id": "sec-02",
    "module": "m01",
    "kind": "scenario",
    "prompt": "Nomsa says her accounts hold nothing worth stealing, so she uses one password for her email, her cloud storage and a gaming site. Which response is most accurate?",
    "options": [
      "Her email is the real prize, because it can reset her other accounts, so the reuse puts much more than a game at risk",
      "She is right, because criminals only bother with people who have large savings",
      "Only her bank account matters, so the other passwords can be shared freely",
      "The risk is small as long as she avoids using public Wi-Fi"
    ],
    "correct": [
      0
    ],
    "explain": "Email often receives password-reset links for other services, so whoever controls it can reach much more. Attackers want what an account can unlock, and reused passwords let one leak open many doors."
  },
  {
    "id": "sec-03",
    "module": "m01",
    "kind": "truefalse",
    "prompt": "Defence in depth means choosing one very strong protection and relying on it alone.",
    "options": [
      "True",
      "False"
    ],
    "correct": [
      1
    ],
    "explain": "Defence in depth stacks several layers, such as unique passwords, a second sign-in step, updates, awareness and backups, so that when one layer fails another still stands in the way."
  },
  {
    "id": "sec-04",
    "module": "m02",
    "kind": "single",
    "prompt": "Which choice is the strongest password for an account you will sometimes type by hand?",
    "options": [
      "Your dog's name with a capital letter, a number and an exclamation mark added",
      "Five unrelated, randomly chosen words strung together",
      "A line from your favourite song with a few letters swapped for symbols",
      "A short word you like, with the usual letter swaps such as an a for an @"
    ],
    "correct": [
      1
    ],
    "explain": "Length and unpredictability matter most. Random unrelated words give a long password that is also easy to remember, while decorated words, song lines and familiar swaps follow patterns guessing software tries early."
  },
  {
    "id": "sec-05",
    "module": "m02",
    "kind": "single",
    "prompt": "Why can a leak from a small website endanger your email account?",
    "options": [
      "Websites routinely share their password lists with email providers",
      "Passwords on every other account expire when one site is breached",
      "Long passwords cannot be stored safely by any website",
      "Criminals try leaked email and password pairs on other services, and a reused password will work there"
    ],
    "correct": [
      3
    ],
    "explain": "Leaked pairs are collected and tried on other services. If your email uses the same password as the breached site, the attacker walks in. A unique password makes the leak useless elsewhere."
  },
  {
    "id": "sec-06",
    "module": "m02",
    "kind": "multi",
    "prompt": "A service you use announces a data breach. Select all that apply: which actions are sensible?",
    "options": [
      "Change that account's password using the official app or a website address you type yourself",
      "Add a '1' to the end of the old password and carry on using it",
      "Replace the same password on any other account where you reused it",
      "Turn on a second sign-in step for that account"
    ],
    "correct": [
      0,
      2,
      3
    ],
    "explain": "Change the exposed password, remove it everywhere it was reused and add a second step. A small tweak to the old password is predictable and still leaves you exposed."
  },
  {
    "id": "sec-07",
    "module": "m03",
    "kind": "scenario",
    "prompt": "Chipo is watching television when her phone shows a sign-in approval request for her email. She has not tried to sign in anywhere. What should she do?",
    "options": [
      "Approve it, then check whether anything in the account has changed",
      "Ignore it, since the request will expire on its own",
      "Approve it so the prompts stop, then think about it tomorrow",
      "Deny it and change the account's password, because someone may already know it"
    ],
    "correct": [
      3
    ],
    "explain": "A prompt you did not trigger means someone has your password. Deny it and change the password. Approving to make the buzzing stop is exactly what attackers hope for."
  },
  {
    "id": "sec-08",
    "module": "m03",
    "kind": "single",
    "prompt": "Which statement best reflects the course's advice about SMS codes as a second factor?",
    "options": [
      "They are far better than no second factor, but stronger options are better for email and banking because a SIM swap can expose the codes",
      "They are the strongest option available and should be preferred to everything else",
      "They are worthless and are better turned off",
      "They are safe from fake websites because they arrive on your phone"
    ],
    "correct": [
      0
    ],
    "explain": "Any MFA beats none. SMS codes travel over the phone network, so a SIM swap can expose them, and they can be typed into a fake site. Choose an authenticator app, hardware key or passkey for the accounts that matter most."
  },
  {
    "id": "sec-09",
    "module": "m03",
    "kind": "truefalse",
    "prompt": "A genuine service will never need you to read out a one-time code it has just sent to your phone.",
    "options": [
      "True",
      "False"
    ],
    "correct": [
      0
    ],
    "explain": "One-time codes are for you to type into the service yourself. Anyone asking you to read one out, forward it or share it is trying to take over your account."
  },
  {
    "id": "sec-10",
    "module": "m04",
    "kind": "scenario",
    "prompt": "You are expecting a parcel when a text says it is held until you pay a small redelivery fee through a link. What is the best next step?",
    "options": [
      "Pay it, since the amount is too small for a scammer to bother with",
      "Reply to the message asking them to confirm the courier's name",
      "Ignore the link and check the courier's or the shop's own app or website for the parcel's status",
      "Forward the link to a friend to see whether they received the same text"
    ],
    "correct": [
      2
    ],
    "explain": "The small fee is the hook, and the link leads to a page that collects card details. Checking through the official app or site, which you chose yourself, is the verification habit the course teaches."
  },
  {
    "id": "sec-11",
    "module": "m04",
    "kind": "single",
    "prompt": "What does verifying through a second channel mean?",
    "options": [
      "Replying to the suspicious message to ask if it is genuine",
      "Confirming a request using contact details you already trust, not ones supplied by the sender",
      "Sending the same reply from two different email addresses",
      "Asking the sender to repeat the request by text as well as by email"
    ],
    "correct": [
      1
    ],
    "explain": "A scammer controls the channel they contact you through, so checking inside it proves nothing. Use a number, app or address you already know to be genuine."
  },
  {
    "id": "sec-12",
    "module": "m04",
    "kind": "single",
    "prompt": "A recruiter you have never heard of offers you a well-paid job. Which request is the clearest sign of a scam?",
    "options": [
      "A request to send your CV and a short summary of your experience",
      "An invitation to a short video interview later in the week",
      "A message that mentions a salary range for the role",
      "A request to pay a fee for training or a uniform before you have a contract"
    ],
    "correct": [
      3
    ],
    "explain": "Real employers do not charge you to start work. A CV, an interview and a salary range are normal parts of recruitment, while upfront fees and early requests for ID or bank details are warning signs."
  },
  {
    "id": "sec-13",
    "module": "m05",
    "kind": "single",
    "prompt": "Why is syncing a folder to cloud storage not the same as having a backup?",
    "options": [
      "A locked or accidentally deleted file can sync across too, replacing the good copy unless older versions are kept",
      "Cloud services keep files for only one day before deleting them",
      "Syncing stores only the names of your files, not their contents",
      "Files in the cloud can never be recovered once they have synced"
    ],
    "correct": [
      0
    ],
    "explain": "Sync mirrors changes, including damage. A real backup keeps separate, older copies, ideally with version history, so you can go back to a good state."
  },
  {
    "id": "sec-14",
    "module": "m05",
    "kind": "scenario",
    "prompt": "Kabelo's laptop shows a note saying his files are locked unless he pays in cryptocurrency. His latest backup is on an external drive that is currently plugged in. What should he do first?",
    "options": [
      "Pay the ransom quickly, because the plugged-in drive is probably locked too",
      "Plug the backup drive into other computers to check whether it still works",
      "Disconnect the laptop from the network and the drive from the laptop, then get help before restoring anything",
      "Restart the laptop several times in case the note disappears"
    ],
    "correct": [
      2
    ],
    "explain": "Disconnecting stops the problem spreading and protects the backup. Paying brings no guarantee, and connecting the drive to other machines could spread the infection."
  },
  {
    "id": "sec-15",
    "module": "m05",
    "kind": "multi",
    "prompt": "Select all that apply: which of these are common ways malware reaches a device?",
    "options": [
      "Installing a free cracked copy of paid software",
      "Leaving the screen brightness on its highest setting",
      "Opening an unexpected invoice attachment",
      "Switching the device off overnight",
      "Running software with known weaknesses that were never updated"
    ],
    "correct": [
      0,
      2,
      4
    ],
    "explain": "Malware usually arrives through ordinary choices: pirated software, unexpected attachments and unpatched programs. Screen brightness and powering off have nothing to do with it."
  },
  {
    "id": "sec-16",
    "module": "m06",
    "kind": "single",
    "prompt": "Reading from the domain, which address most plausibly belongs to the organisation Examplebank?",
    "options": [
      "examplebank.account-check.example/login",
      "secure.examplebank-help.example/login",
      "examp1ebank.example/login",
      "online.examplebank.example/login"
    ],
    "correct": [
      3
    ],
    "explain": "The owner is the domain just before the first single slash. In the last address that is examplebank.example, with online as a label the owner chose. The others have a different owner or a lookalike spelling."
  },
  {
    "id": "sec-17",
    "module": "m06",
    "kind": "single",
    "prompt": "What is the safest way to reach your bank's website each time you bank online?",
    "options": [
      "Click the first sponsored result in a search engine",
      "Use a bookmark you saved earlier, or the bank's official app",
      "Follow the link in a text message that mentions your account",
      "Tap the link in any email that carries the bank's logo"
    ],
    "correct": [
      1
    ],
    "explain": "A bookmark or the official app takes you to an address you already trust. Search adverts, text links and logo-bearing emails can all lead to lookalike pages."
  },
  {
    "id": "sec-18",
    "module": "m06",
    "kind": "truefalse",
    "prompt": "When a fake virus alert fills your screen, the safest move is to click its Close button, because that is what it is for.",
    "options": [
      "True",
      "False"
    ],
    "correct": [
      1
    ],
    "explain": "Buttons inside a fake alert may be part of the trick. Close the browser the normal way, or restart the device, and do not call any number shown."
  },
  {
    "id": "sec-19",
    "module": "m07",
    "kind": "single",
    "prompt": "What does 'share the minimum' mean in everyday practice?",
    "options": [
      "Share personal details only with people you have known for years",
      "Hand over everything once so you are not asked again",
      "Always send personal details in an encrypted file",
      "Give an organisation only what it genuinely needs for the purpose, and ask why before giving more"
    ],
    "correct": [
      3
    ],
    "explain": "Information you never handed over cannot leak from someone else's system. The habit is to question why each detail is needed and withhold what is not."
  },
  {
    "id": "sec-20",
    "module": "m07",
    "kind": "scenario",
    "prompt": "Mpho must email a copy of her ID to a letting agent for a rental application. Which approach reduces the risk most?",
    "options": [
      "Send it only to the named agent, mark the copy with its purpose and date, and delete stored copies once the application is done",
      "Send it from a shared office mailbox so colleagues can help if there is a problem",
      "Add copies of her payslips and bank statements now to avoid being asked later",
      "Send an unmarked zip file without a password so it opens easily"
    ],
    "correct": [
      0
    ],
    "explain": "Limiting recipients, marking the copy for a single purpose and removing it afterwards follows the share-the-minimum and retention habits. Extra documents and shared mailboxes widen the exposure."
  },
  {
    "id": "sec-21",
    "module": "m07",
    "kind": "single",
    "prompt": "What does device encryption mainly protect against?",
    "options": [
      "Phishing messages that arrive while the device is in use",
      "Malware you download and install yourself",
      "A stranger reading your files while you are using an unlocked phone",
      "Someone reading the files on a locked device that is lost or stolen"
    ],
    "correct": [
      3
    ],
    "explain": "Encryption scrambles stored data so a thief who takes the hardware cannot read it. It does not stop scams or malware, and it gives little protection while the device is unlocked."
  },
  {
    "id": "sec-22",
    "module": "m08",
    "kind": "single",
    "prompt": "A visitor's phone is already on your Wi-Fi. Which router setting stops them simply logging in to the router's settings page with the manufacturer's default login?",
    "options": [
      "A longer Wi-Fi password",
      "A new, strong router admin password",
      "Hiding the name of the network",
      "Switching the router off overnight"
    ],
    "correct": [
      1
    ],
    "explain": "The admin password protects the router's settings and is separate from the Wi-Fi password. Default admin logins are widely known, so changing it is one of the most valuable router tasks."
  },
  {
    "id": "sec-23",
    "module": "m08",
    "kind": "single",
    "prompt": "Why should you be cautious about a free VPN from an unknown company?",
    "options": [
      "Free VPNs are always too slow to use",
      "VPNs are illegal to use on public networks",
      "You are trusting its owner with a view of where your traffic goes, and someone has to be paying for the servers",
      "A VPN can only be used for workplace systems"
    ],
    "correct": [
      2
    ],
    "explain": "A VPN moves your trust from the local network to the VPN company. An unknown free provider may make money from the information it can see."
  },
  {
    "id": "sec-24",
    "module": "m08",
    "kind": "multi",
    "prompt": "Select all that apply: which settings help limit the damage if your phone is stolen?",
    "options": [
      "A strong PIN or passphrase as the screen lock",
      "Showing the full text of messages on the lock screen",
      "Find-my-device switched on in advance",
      "Allowing installs from outside the official app store",
      "Device encryption turned on"
    ],
    "correct": [
      0,
      2,
      4
    ],
    "explain": "A strong lock, a locate-lock-erase feature set up before you need it and encryption all make a stolen phone far less useful. Full previews can reveal one-time codes on the lock screen, and unknown app sources add risk."
  },
  {
    "id": "sec-25",
    "module": "m09",
    "kind": "single",
    "prompt": "Why do social engineers often begin by collecting small facts from your public social media posts?",
    "options": [
      "Each fact makes a later impersonation or story more believable",
      "Those facts let them bypass the encryption on your device",
      "Social platforms are required to hand posts to anyone who asks",
      "They need the facts to install malware directly on your phone"
    ],
    "correct": [
      0
    ],
    "explain": "Names, routines and holiday dates make a fake caller or message sound genuine. Small harmless-looking details add up, which is why limiting what you post reduces the risk."
  },
  {
    "id": "sec-26",
    "module": "m09",
    "kind": "scenario",
    "prompt": "A supplier phones Lindiwe, who runs a small shop, and says their bank details have changed and today's invoice must go to the new account. The caller sounds familiar and knows the invoice number. What should she do?",
    "options": [
      "Pay as asked, since the caller knew the invoice number",
      "Pay half to the new account and half to the old one until it is sorted",
      "Ask the caller to email the new details and use those if the address looks right",
      "Hold the payment and confirm by phoning the supplier on a number she already has on file"
    ],
    "correct": [
      3
    ],
    "explain": "Knowing a few details proves little, and a voice can be copied. Confirming a bank-detail change through a trusted second channel is the rule that stops invoice fraud."
  },
  {
    "id": "sec-27",
    "module": "m09",
    "kind": "single",
    "prompt": "Which situation best describes credential stuffing?",
    "options": [
      "A criminal watches over your shoulder as you type a password",
      "Software tries email and password pairs leaked from one site on many other services",
      "A caller talks you into reading out a one-time code",
      "A fake app records what you type on your keyboard"
    ],
    "correct": [
      1
    ],
    "explain": "Credential stuffing automatically reuses leaked login pairs elsewhere. It works only against people who reuse passwords, which is why unique passwords and a second factor defeat it."
  },
  {
    "id": "sec-28",
    "module": "m10",
    "kind": "single",
    "prompt": "In a simple personal risk assessment, how do you judge the size of a risk?",
    "options": [
      "By how much the device or account originally cost",
      "By how long it is since you last changed the password",
      "By combining how likely the problem is with how damaging it would be",
      "By the number of apps installed on the device"
    ],
    "correct": [
      2
    ],
    "explain": "Risk is likelihood combined with impact. Rating both, even roughly as low, medium and high, shows you which items to fix first."
  },
  {
    "id": "sec-29",
    "module": "m10",
    "kind": "scenario",
    "prompt": "Dumi wrote down forty security tasks after reading about threats, and a month later has finished none. What does the course suggest he do?",
    "options": [
      "Reorder them into a short 30-day plan, starting with email and other key accounts, in small weekly sets",
      "Try to do all forty in one long evening to get it over with",
      "Do only the quickest tasks first, whichever account they relate to",
      "Wait until an incident happens, then use the list"
    ],
    "correct": [
      0
    ],
    "explain": "A short, ordered plan that begins with the accounts that unlock everything else gets finished. Overloaded lists tend to be abandoned, and waiting for an incident gives up the benefit of preparing."
  },
  {
    "id": "sec-30",
    "module": "m10",
    "kind": "single",
    "prompt": "After a scam, why should you keep the messages, screenshots and transaction details?",
    "options": [
      "So you can post them online to shame the scammer",
      "So you can show the scammer you know what they did",
      "So you can pay the scammer later if they ask again",
      "They help your bank, employer or the police investigate and may support a claim"
    ],
    "correct": [
      3
    ],
    "explain": "Evidence helps the people who can act, such as banks and investigators. Deleting it removes information that could help recover money or stop the criminal."
  },
];
