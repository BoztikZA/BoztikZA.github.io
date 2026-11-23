import type { ExamQuestion } from "../types.ts";

export const questions: ExamQuestion[] = [
  {
    "id": "ai-01",
    "module": "m01",
    "kind": "single",
    "prompt": "Which of these is an example of narrow AI that you have very likely used already?",
    "options": [
      "A machine that sets its own goals and decides how to pursue them",
      "One program that is an expert in every subject",
      "A phone keyboard that suggests the next word as you type",
      "A system that has feelings about the messages it reads"
    ],
    "correct": [
      2
    ],
    "explain": "A next-word suggestion is a narrow, pattern-based tool built for one job. Machines with their own goals, feelings or universal expertise belong to science fiction, not to tools in use today."
  },
  {
    "id": "ai-02",
    "module": "m01",
    "kind": "scenario",
    "prompt": "A friend says, 'Chat assistants are basically databases of verified facts, so I copy their answers straight into my reports.' What is the most accurate reply?",
    "options": [
      "That is fine, because they only store facts that people have verified first",
      "That is fine as long as the answer is written in a confident tone",
      "That only applies to image tools, not to text assistants",
      "They produce answers that look right based on learned patterns, so claims that matter still need checking"
    ],
    "correct": [
      3
    ],
    "explain": "Chat assistants generate plausible text from patterns. They are not stores of checked facts, and a confident tone does not make a statement true."
  },
  {
    "id": "ai-03",
    "module": "m01",
    "kind": "truefalse",
    "prompt": "True or false: the movie idea of a machine with its own goals and feelings describes the AI tools that ordinary people use at work today.",
    "options": [
      "True",
      "False"
    ],
    "correct": [
      1
    ],
    "explain": "Everything in real use today is narrow, pattern-based software. A machine with its own goals and feelings is science fiction."
  },
  {
    "id": "ai-04",
    "module": "m02",
    "kind": "single",
    "prompt": "In the context of AI, what does the word 'training' refer to?",
    "options": [
      "Each time you type a question into a chat assistant",
      "The process of you learning to write better prompts",
      "The earlier, costly stage in which a system adjusts itself using a very large number of examples",
      "A final read-through of the output before it is sent"
    ],
    "correct": [
      2
    ],
    "explain": "Training is the build stage run by the company before release. Typing a question is 'using' the trained system, which does not retrain it on the spot."
  },
  {
    "id": "ai-05",
    "module": "m02",
    "kind": "single",
    "prompt": "A tool was trained to tell two kinds of animal apart. It scored well in testing, then failed when one animal appeared on grass instead of snow. What is the best explanation?",
    "options": [
      "It understood the animals well but chose to ignore the grass",
      "It picked up a pattern in the examples, such as snowy backgrounds, that was not the one the builders intended",
      "Its internal settings were changed by the testers during the test",
      "It was reading each photo's caption instead of the picture"
    ],
    "correct": [
      1
    ],
    "explain": "A system learns only what its examples show. If one animal was mostly photographed on snow, snow can become the pattern, which fails the moment the setting changes."
  },
  {
    "id": "ai-06",
    "module": "m02",
    "kind": "multi",
    "prompt": "Which of the following follow from how language models work? Select all that apply.",
    "options": [
      "The same prompt can produce different replies on different tries",
      "Details from early in a very long chat can drop out of view",
      "It will always know about events from the past week",
      "It checks every statement against a database before writing it",
      "It is better at rewording a paragraph than at quoting a local clinic's exact opening hours"
    ],
    "correct": [
      0,
      1,
      4
    ],
    "explain": "Controlled randomness explains varied replies, the limited context window explains forgetting, and pattern knowledge makes rewording easier than recalling niche facts. Training stops at a cut-off date, and a model does not check statements as it writes."
  },
  {
    "id": "ai-07",
    "module": "m03",
    "kind": "single",
    "prompt": "When does the course suggest a specialised AI tool rather than a general chat assistant?",
    "options": [
      "When the job is varied and you want to think out loud",
      "When you want a one-off brainstorm with no fixed format",
      "When you are exploring a topic you have not studied before",
      "When the job is routine and you do it often, such as transcribing meetings"
    ],
    "correct": [
      3
    ],
    "explain": "Specialised tools suit routine, repeated jobs with consistent results. Chat assistants suit varied work and thinking out loud."
  },
  {
    "id": "ai-08",
    "module": "m03",
    "kind": "scenario",
    "prompt": "A shop owner wants an assistant's help with a large invoice. She needs the exact VAT amount and also a friendly covering note. Which handling is most sensible?",
    "options": [
      "Use the assistant for the note, and work out the VAT with a calculator or spreadsheet she can check",
      "Ask the assistant for both and send them without checking, since it sounds confident",
      "Ask the assistant for both, then ask it whether it is sure",
      "Leave out the VAT figure so there is nothing to get wrong"
    ],
    "correct": [
      0
    ],
    "explain": "Exact arithmetic is a poor fit for pattern-based text tools and is easy to do with a calculator. The covering note is a low-risk drafting task."
  },
  {
    "id": "ai-09",
    "module": "m03",
    "kind": "single",
    "prompt": "Which habit does the course suggest to make AI use safer in everyday tasks?",
    "options": [
      "Prefer long outputs, since more text means more checking has been done",
      "Avoid testing anything that looks plausible",
      "Choose output you can verify quickly, such as a formula you can test on sample rows",
      "Ask for results that only an expert could judge"
    ],
    "correct": [
      2
    ],
    "explain": "The cheaper a result is to check, the safer it is to use AI for it. Plausible-looking output is exactly what needs a quick test."
  },
  {
    "id": "ai-10",
    "module": "m04",
    "kind": "single",
    "prompt": "In the six-ingredient model of a good prompt, what does 'constraints' cover?",
    "options": [
      "Who will read the finished text",
      "What must or must not appear, such as a word limit, a tone or a required price",
      "A sample of what good output looks like",
      "A description of your situation and background"
    ],
    "correct": [
      1
    ],
    "explain": "Constraints are the limits and requirements. Audience, examples and context are separate ingredients."
  },
  {
    "id": "ai-11",
    "module": "m04",
    "kind": "single",
    "prompt": "Why might you ask an assistant to interview you with questions before it drafts a quote?",
    "options": [
      "It makes the assistant's answers shorter",
      "It prevents the assistant from ever making mistakes",
      "It lets the assistant take decisions on pricing for you",
      "It brings out facts you had not thought to include before any draft is written"
    ],
    "correct": [
      3
    ],
    "explain": "The questions expose gaps in your own notes, such as missing deposit terms or travel costs, so the draft starts from complete facts."
  },
  {
    "id": "ai-12",
    "module": "m04",
    "kind": "single",
    "prompt": "Which piece of feedback gives an assistant the most useful direction for improving a draft?",
    "options": [
      "Cut it to 60 words and put the price in the first line",
      "Make it better",
      "Not what I wanted",
      "Make it sound more clever"
    ],
    "correct": [
      0
    ],
    "explain": "Specific, checkable instructions let the assistant keep what works and change what does not. Vague feedback forces it to guess again."
  },
  {
    "id": "ai-13",
    "module": "m05",
    "kind": "single",
    "prompt": "In the safe research workflow, what comes after the assistant has given you an overview and suggested what to look up?",
    "options": [
      "Asking the assistant to supply the sources for you and citing them as given",
      "Saving the overview as your finished findings",
      "Finding real sources yourself, such as official sites, textbooks or journals, and opening them",
      "Asking the assistant to rate how reliable its own overview was"
    ],
    "correct": [
      2
    ],
    "explain": "The assistant is a map to the topic, not a source. You find and read real sources, then work from their text."
  },
  {
    "id": "ai-14",
    "module": "m05",
    "kind": "scenario",
    "prompt": "You ask an assistant whether a statistic it just gave you is correct, and it replies that the figure is accurate. What does the course advise?",
    "options": [
      "Accept it, because the tool has now confirmed its own answer",
      "Treat its reassurance as a cue to look for the figure in a trusted source",
      "Add the statistic to your report and mention that the assistant checked it",
      "Ask the same question again until the answer stays the same"
    ],
    "correct": [
      1
    ],
    "explain": "A tool that invented a figure will often defend it. Verification means finding the figure in an independent source that a person or organisation stands behind."
  },
  {
    "id": "ai-15",
    "module": "m05",
    "kind": "truefalse",
    "prompt": "True or false: to keep your own voice, it is better to write a rough draft yourself first and then ask the assistant to help edit it.",
    "options": [
      "True",
      "False"
    ],
    "correct": [
      0
    ],
    "explain": "Starting from your own draft keeps your ideas, facts and wording. The assistant then improves clarity and flow instead of replacing your voice."
  },
  {
    "id": "ai-16",
    "module": "m06",
    "kind": "single",
    "prompt": "When you paste in email subject lines and ask an assistant to sort them, what is the assistant's job?",
    "options": [
      "To decide what matters to you and act without your input",
      "To give a first-pass sort that you review against what is really urgent in your situation",
      "To reply to every message on your behalf",
      "To remove the need to read any of your email"
    ],
    "correct": [
      1
    ],
    "explain": "Triage is a first pass. You decide what is urgent, because only you know your real situation and commitments."
  },
  {
    "id": "ai-17",
    "module": "m06",
    "kind": "single",
    "prompt": "What separates using an assistant as a helpful tutor from collecting confident half-truths?",
    "options": [
      "You let it choose the topics and never question its answers",
      "You avoid asking it to quiz you",
      "You stay in charge of the learning and check anything important",
      "You use it only for facts you cannot verify"
    ],
    "correct": [
      2
    ],
    "explain": "The assistant can explain and quiz, but you remain responsible for the learning and for verifying anything that matters."
  },
  {
    "id": "ai-18",
    "module": "m06",
    "kind": "multi",
    "prompt": "When you use an assistant to help reply to email, which tasks belong with you rather than the assistant? Select all that apply.",
    "options": [
      "Providing the facts, prices and promises",
      "Reading every word before sending",
      "Making the tone warmer or firmer",
      "Checking names, dates, amounts and attachments",
      "Suggesting a subject line"
    ],
    "correct": [
      0,
      1,
      3
    ],
    "explain": "Facts, promises and final checks stay human. Adjusting tone and suggesting subject lines are tasks the assistant can do for you."
  },
  {
    "id": "ai-19",
    "module": "m07",
    "kind": "scenario",
    "prompt": "An electrician's draft reply to a customer says the rewired board is 'fully safe and compliant'. He never told the assistant that. What is the right handling?",
    "options": [
      "Keep it, since a cheerful, confident reply reassures customers",
      "Keep it but add a smiley so it sounds less formal",
      "Ask the assistant to say it again in different words",
      "Remove it, and use only safety wording that he supplied or that a qualified person has reviewed"
    ],
    "correct": [
      3
    ],
    "explain": "Safety and compliance statements must come from the person responsible. An assistant should not make claims that were not given to it."
  },
  {
    "id": "ai-20",
    "module": "m07",
    "kind": "single",
    "prompt": "Which approach best describes how to use AI to write a simple standard operating procedure?",
    "options": [
      "Describe the job aloud or in rough bullets, ask for numbered steps, flag gaps, then test it with someone who has not done the job",
      "Give the assistant only the job title and circulate whatever it writes",
      "Ask for a long document and skip any testing",
      "Have the assistant fill in every gap with its best guess"
    ],
    "correct": [
      0
    ],
    "explain": "The content comes from you, the assistant organises it, and a trial run by a newcomer shows where the steps fail."
  },
  {
    "id": "ai-21",
    "module": "m07",
    "kind": "single",
    "prompt": "For which type of customer message does the course suggest the least help from AI?",
    "options": [
      "A simple enquiry about opening hours",
      "A courteous note about a rescheduled appointment",
      "A message that makes statements about safety or health",
      "A request for a price list you already have"
    ],
    "correct": [
      2
    ],
    "explain": "Safety and health statements should come from you or a qualified reviewer. Routine enquiries and delay notes are low-risk drafting jobs."
  },
  {
    "id": "ai-22",
    "module": "m08",
    "kind": "single",
    "prompt": "Which set of details does the course suggest you describe when asking an image tool for a picture?",
    "options": [
      "Subject, style, light and colour, and composition",
      "Budget, deadline, audience size and file format",
      "Camera brand, lens price and tripod model",
      "Your name, the date and the intended website"
    ],
    "correct": [
      0
    ],
    "explain": "Image tools respond to what is in the picture, its style, its lighting and mood, and how it is framed."
  },
  {
    "id": "ai-23",
    "module": "m08",
    "kind": "single",
    "prompt": "Why does the course suggest adding the words to a flyer yourself rather than asking the image tool to draw them?",
    "options": [
      "Text in images is always illegal to generate",
      "Image tools often struggle to produce readable text",
      "Image tools cannot produce any colours",
      "Typed words make the image file too large to share"
    ],
    "correct": [
      1
    ],
    "explain": "Generated lettering often comes out blurry or meaningless. Adding text in a design app gives you clear, correct wording."
  },
  {
    "id": "ai-24",
    "module": "m08",
    "kind": "truefalse",
    "prompt": "True or false: an AI-enhanced version of a blurry old photograph is a more accurate record of the past than the original file.",
    "options": [
      "True",
      "False"
    ],
    "correct": [
      1
    ],
    "explain": "Enhancement tools fill gaps with plausible guesses. The result may look sharper while showing features that were never in the original."
  },
  {
    "id": "ai-25",
    "module": "m09",
    "kind": "single",
    "prompt": "Which of these should you never paste into an online AI tool?",
    "options": [
      "A paragraph from a published news article",
      "A made-up example customer you invented for practice",
      "A general question about how spreadsheets work",
      "A bank account number, card number or password"
    ],
    "correct": [
      3
    ],
    "explain": "Financial credentials must never be shared with a tool. Public text, invented examples and general questions carry little privacy risk."
  },
  {
    "id": "ai-26",
    "module": "m09",
    "kind": "multi",
    "prompt": "Which of the following are sensible protections against deepfake scams? Select all that apply.",
    "options": [
      "Contact the person on a number you already have before acting on a request",
      "Look for the original source of a suspicious clip",
      "Be wary of content designed to make you angry or afraid",
      "Reply to the suspicious message and ask whether it is genuine",
      "Trust a voice note if it sounds exactly like someone you know"
    ],
    "correct": [
      0,
      1,
      2
    ],
    "explain": "Verification through a separate trusted channel, checking sources and slowing down all help. Replying in the same thread keeps you talking to the sender, and a convincing voice proves nothing because voices can be cloned."
  },
  {
    "id": "ai-27",
    "module": "m09",
    "kind": "scenario",
    "prompt": "A school allows AI for brainstorming but not for writing. A learner has an assistant write her whole essay and submits it, saying the quality was high. How does the course treat this?",
    "options": [
      "It counts as cheating, whatever the quality, because the rules were not followed",
      "It is acceptable, because the quality was high",
      "It is acceptable, because she typed the request herself",
      "It is acceptable as long as she did not read the rules"
    ],
    "correct": [
      0
    ],
    "explain": "Presenting AI-written work as your own where it is not allowed is cheating. Responsibility for the work and for following the rules stays with the person who submits it."
  },
  {
    "id": "ai-28",
    "module": "m10",
    "kind": "single",
    "prompt": "What is the main purpose of replacing changing details with square-bracket placeholders in a prompt that worked well?",
    "options": [
      "To hide the prompt from the assistant",
      "To make the assistant ignore the facts you give it",
      "To turn it into a fill-in-the-blanks template you can reuse next time",
      "To shorten the reply the assistant writes"
    ],
    "correct": [
      2
    ],
    "explain": "A template keeps the structure that worked, and you supply only the new facts each time."
  },
  {
    "id": "ai-29",
    "module": "m10",
    "kind": "single",
    "prompt": "Which result would show that an AI workflow is not actually saving you time?",
    "options": [
      "The assistant produced a draft within seconds",
      "You spend as long correcting the draft as you would have spent writing it yourself",
      "You needed a checklist to review the draft",
      "You reused a saved template for the second week in a row"
    ],
    "correct": [
      1
    ],
    "explain": "Time saved must include review and fixing. If correcting takes as long as writing, the step should be redesigned or removed."
  },
  {
    "id": "ai-30",
    "module": "m10",
    "kind": "scenario",
    "prompt": "A tutor wants her weekly parent messages written by AI and sent automatically with nobody reading them first. What is the best advice?",
    "options": [
      "Go ahead, since a good template guarantees accurate messages",
      "Go ahead, but only for parents who rarely reply",
      "Go ahead and add a checklist the assistant fills in itself",
      "Keep a person reviewing and sending, because anything that sends without checking needs far more care"
    ],
    "correct": [
      3
    ],
    "explain": "A person should check and send anything that reaches others. Automated sending without a review point removes the safeguard that catches invented or wrong details."
  }
];
