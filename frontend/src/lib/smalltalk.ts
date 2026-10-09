// Greetings, thanks and "who are you" are answered directly: no library search, no AI call.
// (Searching the library for "hello" returned random survival articles.)

type Kind = 'greeting' | 'thanks' | 'identity' | 'goodbye' | 'location';

const REPLIES: Record<Kind, string> = {
  greeting: "Hi! I'm CollapseAI, your offline survival helper. Ask me about first aid, safe water, typhoons, floods, earthquakes or food. You can write in English or Tagalog.",
  thanks: "You're welcome. Stay safe. Ask me anything else you need.",
  identity: "I'm CollapseAI. I run on this device with no internet and answer from the survival guides you downloaded: first aid, water, disasters, health and food. I'm not a doctor; for serious injuries get medical help as soon as you can.",
  goodbye: 'Take care and stay safe. I am here whenever you need me.',
  location:
    "I can't look up live locations, but the app can help: open Map to see hospitals, clinics and evacuation centers near you (download your area first), or Compass to walk to a place you saved.",
};

const PATTERNS: [Kind, RegExp][] = [
  ['thanks', /^(thanks?|thank you|thank u|thx|ty|salamat|maraming salamat)( (so much|a lot|very much))?$/],
  ['goodbye', /^(bye|goodbye|good bye|see you|paalam|sige)( (na|later))?$/],
  ['identity', /^(who are you|what are you|who r u|what is your name|what's your name|whats your name|your name|ano ka|sino ka|ano pangalan mo|sino ka ba|what can you do|how are you|how are you doing|kumusta ka|kamusta ka)$/],
  ['greeting', /^((hi|hello|hey|hiya|yo|hola|kumusta|kamusta|musta|good (morning|afternoon|evening|day)|magandang (umaga|tanghali|hapon|gabi|araw))( (there|everyone|all|ai|collapseai))?)$/],
];

/**
 * "Nearest hospital", "closest evacuation center", "pinakamalapit na ospital": a location question.
 * The library can't answer "where", so point to Map / Compass instead of quoting an article.
 */
export function isLocationQuestion(message: string): boolean {
  return /\b(nearest|closest|near me|pinakamalapit)\b/i.test(message);
}

/** A canned reply when the message is only small talk, otherwise null. */
export function smallTalkReply(message: string): string | null {
  const text = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\b(po|ho|naman|please|pls|lang)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (isLocationQuestion(text)) return REPLIES.location;
  for (const [kind, pattern] of PATTERNS) if (pattern.test(text)) return REPLIES[kind];
  return null;
}
