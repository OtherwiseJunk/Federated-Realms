const MIN_GRAPHEMES = 1;
const MAX_GRAPHEMES = 64;

// All control and format characters (\p{Cc} = C0/C1 controls; \p{Cf} = every
// format char: soft hyphen, ZWSP/ZWNJ/ZWJ, LRM/RLM, bidi embeds/overrides/
// isolates, BOM, and the Unicode Tag block U+E0000-E007F used for ASCII
// smuggling), plus variation selectors (\p{Mn}, not covered by Cf) — these
// corrupt rendering, hide content, or forge otherwise-reserved names.
const FORBIDDEN = /[\p{Cc}\p{Cf}\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;

// At least one letter/number/symbol/punctuation, so a name is never only
// whitespace or combining marks.
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;

// Names that could impersonate system actors or the feed bridge, matched
// case-insensitively after normalization + trim. Keep centralized and small.
const RESERVED = new Set([
  "system",
  "server",
  "admin",
  "administrator",
  "moderator",
  "mod",
  "gm",
  "console",
  "you",
  "everyone",
  "here",
]);

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function graphemeCount(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

export function validateCharacterName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: string } {
  const trimmed = raw.normalize("NFC").trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Name cannot be empty." };
  }
  // Check for forbidden characters before collapsing whitespace: U+FEFF is
  // classified as ECMAScript whitespace, so \s+ collapse would otherwise
  // silently turn a smuggled BOM into a plain space before we can catch it.
  if (FORBIDDEN.test(trimmed)) {
    return { ok: false, error: "Name contains disallowed characters." };
  }
  const name = trimmed.replace(/\s+/gu, " ");
  if (!VISIBLE.test(name)) {
    return { ok: false, error: "Name must contain a visible character." };
  }
  const g = graphemeCount(name);
  if (g < MIN_GRAPHEMES || g > MAX_GRAPHEMES) {
    return { ok: false, error: `Name must be ${MIN_GRAPHEMES}-${MAX_GRAPHEMES} characters.` };
  }
  if (RESERVED.has(name.toLowerCase())) {
    return { ok: false, error: "That name is reserved." };
  }
  return { ok: true, name };
}

export function handleLocalPart(handle: string): string {
  if (handle.startsWith("did:")) return "";
  const dot = handle.indexOf(".");
  return dot === -1 ? handle : handle.slice(0, dot);
}
