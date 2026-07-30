import type { Frame, Locator, Page } from "playwright-core";
import type { FrameTarget, PageRef, PageSnapshot } from "./contracts.js";
import { nowIso, sha256 } from "./canonical.js";
import { detectChallenge } from "./challenge.js";
import { CockroachBrowserError } from "./errors.js";

interface RawRef {
  ref: string;
  role: string;
  name: string;
  tag: string;
  text?: string;
  disabled?: boolean;
  checked?: boolean | "mixed";
  expanded?: boolean;
  level?: number;
  href?: string;
  valuePresent?: boolean;
}

export async function captureSnapshot(input: {
  page: Page;
  sessionId: string;
  tabId: string;
  maxChars: number;
}): Promise<PageSnapshot> {
  const pageOrigin = safeOrigin(input.page.url());
  const frames = input.page.frames().filter((frame) => {
    if (frame === input.page.mainFrame()) return true;
    return pageOrigin !== undefined && safeOrigin(frame.url()) === pageOrigin;
  });
  const refs: PageRef[] = [];
  const textParts: string[] = [];
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    if (!frame) continue;
    try {
      const result = await frame.evaluate(
        ({ frameIndex: currentFrameIndex }) => {
          const refAttribute = "data-cockroach-ref";
          const interactiveSelector = [
            "a[href]",
            "button",
            "input",
            "textarea",
            "select",
            "summary",
            "[role]",
            "[contenteditable=true]",
            "[tabindex]:not([tabindex='-1'])"
          ].join(",");
          const visible = (element: Element): boolean => {
            const html = element as HTMLElement;
            const style = globalThis.getComputedStyle(html);
            const rect = html.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
          };
          const roleFor = (element: Element): string => {
            const explicit = element.getAttribute("role");
            if (explicit) return explicit;
            const tag = element.tagName.toLowerCase();
            if (tag === "a") return "link";
            if (tag === "button") return "button";
            if (tag === "textarea") return "textbox";
            if (tag === "select") return "combobox";
            if (tag === "summary") return "button";
            if (tag === "input") {
              const type = (element.getAttribute("type") ?? "text").toLowerCase();
              if (["button", "submit", "reset", "image"].includes(type)) return "button";
              if (type === "checkbox") return "checkbox";
              if (type === "radio") return "radio";
              if (type === "range") return "slider";
              return "textbox";
            }
            return tag;
          };
          const nameFor = (element: Element): string => {
            const html = element as HTMLElement;
            const aria = element.getAttribute("aria-label");
            if (aria?.trim()) return aria.trim();
            const labelledBy = element.getAttribute("aria-labelledby");
            if (labelledBy) {
              const text = labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim())
                .filter(Boolean)
                .join(" ");
              if (text) return text;
            }
            if (element instanceof HTMLInputElement && element.labels?.length) {
              const text = [...element.labels].map((label) => label.textContent?.trim()).filter(Boolean).join(" ");
              if (text) return text;
            }
            return (
              element.getAttribute("alt") ||
              element.getAttribute("title") ||
              element.getAttribute("placeholder") ||
              html.innerText ||
              element.textContent ||
              ""
            ).trim().replace(/\s+/g, " ").slice(0, 240);
          };
          const candidates: Element[] = [];
          const walk = (root: ParentNode): void => {
            candidates.push(...root.querySelectorAll(interactiveSelector));
            for (const element of root.querySelectorAll("*")) {
              if (element.shadowRoot) walk(element.shadowRoot);
            }
          };
          walk(document);
          const seen = new Set<Element>();
          const visibleCandidates = candidates.filter(
            (element) => !seen.has(element) && seen.add(element) && visible(element)
          );
          const acceptedRefs = new Set<string>();
          const refs = visibleCandidates.map((element) => {
            const supplied = element.getAttribute(refAttribute);
            const validSupplied = supplied && new RegExp(`^f${currentFrameIndex}-[a-f0-9]{32}$`, "i").test(supplied)
              && !acceptedRefs.has(supplied);
            const ref = validSupplied
              ? supplied
              : `f${currentFrameIndex}-${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
            acceptedRefs.add(ref);
            if (supplied !== ref) element.setAttribute(refAttribute, ref);
            const input = element as HTMLInputElement;
            const heading = /^H([1-6])$/.exec(element.tagName);
            return {
              ref,
              role: roleFor(element),
              name: nameFor(element),
              tag: element.tagName.toLowerCase(),
              text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 240) || undefined,
              disabled: (element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true" || undefined,
              checked: input.type === "checkbox" || input.type === "radio"
                ? input.indeterminate ? "mixed" : input.checked
                : undefined,
              expanded: element.hasAttribute("aria-expanded") ? element.getAttribute("aria-expanded") === "true" : undefined,
              level: heading ? Number(heading[1]) : undefined,
              href: element instanceof HTMLAnchorElement ? element.href : undefined,
              valuePresent: "value" in input && input.type !== "password"
                ? String(input.value).length > 0
                : undefined
            };
          });
          return {
            text: (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n"),
            refs
          };
        },
        { frameIndex }
      ) as { text: string; refs: RawRef[] };
      if (result.text) textParts.push(result.text);
      refs.push(...result.refs);
    } catch {
      // A frame may disappear between enumeration and evaluation.
    }
  }
  const completeText = textParts.join("\n\n--- frame ---\n\n").trim();
  const truncated = completeText.length > input.maxChars;
  const text = truncated ? completeText.slice(0, input.maxChars) : completeText;
  const challenge = await detectChallenge(input.page);
  const base = {
    sessionId: input.sessionId,
    tabId: input.tabId,
    url: input.page.url(),
    title: await input.page.title(),
    capturedAt: nowIso(),
    text,
    refs,
    ...(challenge.detected ? { challenge } : {}),
    truncated
  };
  const revision = {
    url: base.url,
    title: base.title,
    text: base.text,
    refs: base.refs,
    ...(base.challenge ? { challenge: base.challenge } : {}),
    truncated: base.truncated
  };
  return { ...base, digest: sha256(revision) };
}

export async function locatorForRef(page: Page, ref: string): Promise<Locator> {
  if (!/^f\d+-[a-f0-9]{32}$/i.test(ref)) {
    throw new CockroachBrowserError("INVALID_REF", `Invalid semantic reference: ${ref}`);
  }
  const frameIndex = Number(ref.slice(1, ref.indexOf("-")));
  const pageOrigin = safeOrigin(page.url());
  const frames = page.frames().filter((frame) => {
    if (frame === page.mainFrame()) return true;
    return pageOrigin !== undefined && safeOrigin(frame.url()) === pageOrigin;
  });
  const frame = frames[frameIndex];
  if (!frame) throw new CockroachBrowserError("STALE_REF", `Frame for ${ref} no longer exists.`);
  const locator = frame.locator(`[data-cockroach-ref="${ref}"]`);
  if ((await locator.count()) === 0) throw new CockroachBrowserError("STALE_REF", `Reference ${ref} no longer exists.`);
  return locator.first();
}

export async function frameFor(page: Page, target?: FrameTarget): Promise<Frame> {
  if (!target) return page.mainFrame();
  const populated = [
    target.index !== undefined,
    Boolean(target.name),
    Boolean(target.url)
  ].filter(Boolean).length;
  if (populated === 0) {
    throw new CockroachBrowserError("FRAME_TARGET_INVALID", "A frame target requires index, name, or exact URL.");
  }
  if (
    target.index !== undefined
    && (!Number.isSafeInteger(target.index) || target.index < 0 || target.index > 255)
  ) {
    throw new CockroachBrowserError("FRAME_TARGET_INVALID", "Frame index must be an integer between 0 and 255.");
  }
  if (target.name !== undefined && (!target.name.trim() || target.name.length > 256)) {
    throw new CockroachBrowserError("FRAME_TARGET_INVALID", "Frame name must contain 1 to 256 characters.");
  }
  if (target.url !== undefined && target.url.length > 2_048) {
    throw new CockroachBrowserError("FRAME_TARGET_INVALID", "Frame URL exceeds 2048 characters.");
  }

  const pageOrigin = safeOrigin(page.url());
  if (!pageOrigin) {
    throw new CockroachBrowserError("FRAME_ORIGIN_UNAVAILABLE", "The current page has no admitted HTTP(S) origin.");
  }
  const sameOriginFrames = page.frames().filter((frame) => safeOrigin(frame.url()) === pageOrigin);
  let matches = sameOriginFrames;
  if (target.index !== undefined) {
    const indexed = sameOriginFrames[target.index];
    matches = indexed ? [indexed] : [];
  }
  if (target.name !== undefined) {
    matches = matches.filter((frame) => frame.name() === target.name);
  }
  if (target.url !== undefined) {
    let expected: URL;
    try {
      expected = new URL(target.url);
    } catch {
      throw new CockroachBrowserError("FRAME_TARGET_INVALID", "Frame URL must be an absolute URL.");
    }
    if (expected.origin !== pageOrigin || expected.username || expected.password) {
      throw new CockroachBrowserError(
        "CROSS_ORIGIN_FRAME_DENIED",
        "Explicit frame targeting is limited to credential-free same-origin frames."
      );
    }
    matches = matches.filter((frame) => frame.url() === expected.toString());
  }
  if (matches.length === 0) {
    throw new CockroachBrowserError("FRAME_NOT_FOUND", "No current same-origin frame matches the explicit target.");
  }
  if (matches.length > 1) {
    throw new CockroachBrowserError(
      "FRAME_TARGET_AMBIGUOUS",
      "The frame target matched more than one same-origin frame; add an exact index or URL."
    );
  }
  return matches[0]!;
}

export async function locatorFor(
  page: Page,
  ref?: string,
  selector?: string,
  xpath?: string,
  frameTarget?: FrameTarget
): Promise<Locator> {
  const supplied = [Boolean(ref), Boolean(selector), Boolean(xpath)].filter(Boolean).length;
  if (supplied !== 1) {
    throw new CockroachBrowserError(
      "TARGET_REQUIRED",
      "This action requires exactly one semantic ref, CSS selector, or XPath target."
    );
  }
  if (ref) {
    if (frameTarget) {
      throw new CockroachBrowserError(
        "FRAME_REF_CONFLICT",
        "Semantic references already identify their frame and cannot be combined with a frame target."
      );
    }
    return locatorForRef(page, ref);
  }
  const frame = await frameFor(page, frameTarget);
  if (selector) {
    if (selector.length > 2_048 || selector.includes("\0")) {
      throw new CockroachBrowserError("SELECTOR_INVALID", "CSS selectors must be at most 2048 characters.");
    }
    return frame.locator(selector).first();
  }
  if (!xpath || xpath.length > 2_048 || xpath.includes("\0")) {
    throw new CockroachBrowserError("XPATH_INVALID", "XPath targets must contain 1 to 2048 characters.");
  }
  return frame.locator(`xpath=${xpath}`).first();
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
