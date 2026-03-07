import type { MixinButton, MixinCard } from "./send-service.js";

type LinkItem = {
  label: string;
  url: string;
};

export type MixinReplyPlan =
  | { kind: "text"; text: string }
  | { kind: "post"; text: string }
  | { kind: "buttons"; intro?: string; buttons: MixinButton[] }
  | { kind: "card"; card: MixinCard };

const MAX_BUTTONS = 6;
const MAX_BUTTON_LABEL = 36;
const MAX_CARD_TITLE = 36;
const MAX_CARD_DESCRIPTION = 120;
const TEMPLATE_REGEX = /^```mixin-(text|post|buttons|card)\s*\n([\s\S]*?)\n```$/i;

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function isValidHttpUrl(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseJsonTemplate<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function parseTextTemplate(body: string): MixinReplyPlan | null {
  const text = normalizeWhitespace(body);
  return text ? { kind: "text", text } : null;
}

function parsePostTemplate(body: string): MixinReplyPlan | null {
  const text = normalizeWhitespace(body);
  return text ? { kind: "post", text } : null;
}

function parseButtonsTemplate(body: string): MixinReplyPlan | null {
  const parsed = parseJsonTemplate<{ intro?: string; buttons?: MixinButton[] } | MixinButton[]>(body);
  if (!parsed) {
    return null;
  }

  const intro = Array.isArray(parsed) ? undefined : typeof parsed.intro === "string" ? normalizeWhitespace(parsed.intro) : undefined;
  const buttons = (Array.isArray(parsed) ? parsed : parsed.buttons ?? [])
    .filter((button) => typeof button?.label === "string" && isValidHttpUrl(button?.action))
    .slice(0, MAX_BUTTONS)
    .map((button) => ({
      label: truncate(normalizeWhitespace(button.label), MAX_BUTTON_LABEL),
      color: button.color,
      action: button.action,
    }));

  if (buttons.length === 0) {
    return null;
  }

  return { kind: "buttons", intro: intro || undefined, buttons };
}

function parseCardTemplate(body: string): MixinReplyPlan | null {
  const parsed = parseJsonTemplate<MixinCard>(body);
  if (!parsed) {
    return null;
  }

  const title = typeof parsed.title === "string" ? truncate(normalizeWhitespace(parsed.title), MAX_CARD_TITLE) : "";
  const description = typeof parsed.description === "string"
    ? truncate(normalizeWhitespace(parsed.description), MAX_CARD_DESCRIPTION)
    : "";
  const action = isValidHttpUrl(parsed.action) ? parsed.action : undefined;
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions
      .filter((button) => typeof button?.label === "string" && isValidHttpUrl(button?.action))
      .slice(0, MAX_BUTTONS)
      .map((button) => ({
        label: truncate(normalizeWhitespace(button.label), MAX_BUTTON_LABEL),
        color: button.color,
        action: button.action,
      }))
    : undefined;
  const coverUrl = isValidHttpUrl(parsed.coverUrl) ? parsed.coverUrl : undefined;
  const iconUrl = isValidHttpUrl(parsed.iconUrl) ? parsed.iconUrl : undefined;

  if (!title || !description) {
    return null;
  }

  return {
    kind: "card",
    card: {
      title,
      description,
      action,
      actions,
      coverUrl,
      iconUrl,
      shareable: parsed.shareable,
    },
  };
}

function parseExplicitTemplate(text: string): MixinReplyPlan | null {
  const match = text.match(TEMPLATE_REGEX);
  if (!match) {
    return null;
  }

  const templateType = (match[1] ?? "").toLowerCase();
  const body = match[2] ?? "";

  if (templateType === "text") {
    return parseTextTemplate(body);
  }

  if (templateType === "post") {
    return parsePostTemplate(body);
  }

  if (templateType === "buttons") {
    return parseButtonsTemplate(body);
  }

  if (templateType === "card") {
    return parseCardTemplate(body);
  }

  return null;
}

function toPlainText(text: string): string {
  return normalizeWhitespace(
    text
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, "$1")
      .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "- "),
  );
}

function extractLinks(text: string): LinkItem[] {
  const links: LinkItem[] = [];
  const seen = new Set<string>();
  const markdownRegex = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const plainUrlRegex = /(^|[\s(])(https?:\/\/[^\s)]+)/g;

  for (const match of text.matchAll(markdownRegex)) {
    const label = normalizeWhitespace(match[1] ?? "");
    const url = match[2] ?? "";
    if (!label || !url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    links.push({ label, url });
  }

  for (const match of text.matchAll(plainUrlRegex)) {
    const url = match[2] ?? "";
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    try {
      const parsed = new URL(url);
      links.push({ label: parsed.hostname, url });
    } catch {
      continue;
    }
  }

  return links;
}

function buildButtons(links: LinkItem[]): MixinButton[] {
  return links.slice(0, MAX_BUTTONS).map((link, index) => ({
    label: truncate(link.label || `Link ${index + 1}`, MAX_BUTTON_LABEL),
    color: index === 0 ? "#0A84FF" : undefined,
    action: link.url,
  }));
}

function detectTitle(text: string, fallback: string): string {
  const lines = normalizeWhitespace(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const candidate = lines[0]?.replace(/^#{1,6}\s+/, "") ?? fallback;
  return truncate(candidate, MAX_CARD_TITLE);
}

function detectCardDescription(text: string, title: string): string {
  const plain = toPlainText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== title);
  return truncate(plain.join(" "), MAX_CARD_DESCRIPTION);
}

function isLongStructuredText(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  const hasCodeBlock = /```[\s\S]*?```/.test(normalized);
  const hasMarkdownTable =
    /^\|.+\|$/m.test(normalized) ||
    /^\s*\|?[-: ]+\|[-|: ]+\|/m.test(normalized);

  return (
    hasCodeBlock ||
    hasMarkdownTable ||
    normalized.length > 420 ||
    lines.length > 8 ||
    /^#{1,6}\s/m.test(normalized) ||
    /^\s*[-*+]\s/m.test(normalized) ||
    /^\d+\.\s/m.test(normalized)
  );
}

export function buildMixinReplyPlan(text: string): MixinReplyPlan | null {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return null;
  }

  const explicit = parseExplicitTemplate(normalized);
  if (explicit) {
    return explicit;
  }

  const links = extractLinks(normalized);

  if (isLongStructuredText(normalized)) {
    return { kind: "post", text: normalized };
  }

  if (links.length >= 2 && links.length <= MAX_BUTTONS) {
    const intro = toPlainText(
      normalized.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "").replace(/https?:\/\/[^\s)]+/g, ""),
    );
    return {
      kind: "buttons",
      intro: intro || undefined,
      buttons: buildButtons(links),
    };
  }

  if (links.length === 1) {
    const title = detectTitle(normalized, links[0].label);
    const description = detectCardDescription(normalized, title) || truncate(links[0].url, MAX_CARD_DESCRIPTION);
    return {
      kind: "card",
      card: {
        title,
        description,
        action: links[0].url,
        shareable: true,
      },
    };
  }

  return { kind: "text", text: toPlainText(normalized) };
}
