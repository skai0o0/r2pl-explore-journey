/** One interactive surface per document. Gameplay mutations stay in their existing owners. */
const activeSurfaces = new WeakMap<Document, UiOverlay>();

export function isUiOverlayOpen(doc: Document = document): boolean {
  return activeSurfaces.has(doc);
}

/** Keep keyboard focus, disclosure state and reading position across authoritative refreshes. */
export function preserveSurface(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  const focused = root.contains(doc.activeElement)
    ? (doc.activeElement as HTMLElement)
    : null;
  const body =
    root.querySelector<HTMLElement>(".unistop-modal-body,.lm-modal-body") ??
    root;
  const scroll = body?.scrollTop ?? 0;
  const details = Array.from(
    root.querySelectorAll<HTMLDetailsElement>("details"),
  ).map((d) => d.open);
  return () => {
    const nextBody =
      root.querySelector<HTMLElement>(".unistop-modal-body,.lm-modal-body") ??
      root;
    if (nextBody) nextBody.scrollTop = scroll;
    root.querySelectorAll<HTMLDetailsElement>("details").forEach((d, i) => {
      if (details[i] !== undefined) d.open = details[i]!;
    });
    if (!focused) return;
    const next = Array.from(
      root.querySelectorAll<HTMLElement>(
        "button,input,select,textarea,a[href]",
      ),
    ).find((el) =>
      focused.id
        ? el.id === focused.id
        : focused.dataset.objectId
          ? el.dataset.objectId === focused.dataset.objectId
          : focused.getAttribute("aria-label")
            ? el.getAttribute("aria-label") ===
              focused.getAttribute("aria-label")
            : el.className === focused.className &&
              el.tagName === focused.tagName &&
              el.textContent === focused.textContent,
    );
    if (next && !(next as HTMLButtonElement).disabled)
      next.focus({ preventScroll: true });
    else root.focus({ preventScroll: true });
  };
}

export class UiOverlay {
  private readonly root: HTMLElement;
  private readonly dismiss: () => void;
  private opener: HTMLElement | null = null;
  private background: { element: HTMLElement; inert: boolean }[] = [];
  private active = false;
  private backdrop: HTMLElement | undefined;
  private readonly keydown = (event: KeyboardEvent) => {
    if (!this.active || activeSurfaces.get(this.root.ownerDocument) !== this)
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.dismiss();
    } else if (event.key === "Tab") {
      const items = this.focusable();
      const first = items[0] ?? this.root;
      const last = items.at(-1) ?? this.root;
      const focused = this.root.ownerDocument.activeElement;
      if (
        !this.root.contains(focused) ||
        focused === this.root ||
        (event.shiftKey ? focused === first : focused === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
  };

  constructor(root: HTMLElement, dismiss: () => void, label: string) {
    this.root = root;
    this.dismiss = dismiss;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", label);
    root.tabIndex = -1;
    for (const name of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "touchstart",
      "touchend",
      "wheel",
    ]) {
      root.addEventListener(name, (event) => event.stopPropagation(), {
        passive: true,
      });
    }
  }

  open(): void {
    if (this.active) return;
    const doc = this.root.ownerDocument;
    const opener = doc.activeElement as HTMLElement | null;
    activeSurfaces.get(doc)?.dismiss();
    this.opener = opener;
    this.active = true;
    activeSurfaces.set(doc, this);
    if (this.root.matches(".gameplay-menu")) {
      this.backdrop = doc.createElement("div");
      this.backdrop.className = "journey-backdrop";
      this.backdrop.setAttribute("aria-hidden", "true");
      for (const name of ["pointerdown", "pointerup", "click"])
        this.backdrop.addEventListener(name, (event) =>
          event.stopPropagation(),
        );
      this.backdrop.addEventListener("click", () => this.dismiss());
      doc.body.append(this.backdrop);
    }
    let branch: HTMLElement = this.root;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const node of Array.from(parent.children)) {
        const child = node as HTMLElement;
        if (
          child === branch ||
          child === this.backdrop ||
          child.matches("script,style,link,.notification-banner-container")
        )
          continue;
        this.background.push({ element: child, inert: child.inert });
        child.inert = true;
      }
      if (parent === doc.body) break;
      branch = parent;
    }
    doc.addEventListener("keydown", this.keydown, true);
    this.focus();
  }

  focus(): void {
    (
      this.root.querySelector<HTMLElement>("[data-autofocus]") ??
      this.focusable()[0] ??
      this.root
    ).focus();
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    const doc = this.root.ownerDocument;
    doc.removeEventListener("keydown", this.keydown, true);
    if (activeSurfaces.get(doc) === this) activeSurfaces.delete(doc);
    for (const { element, inert } of this.background) element.inert = inert;
    this.background = [];
    this.backdrop?.remove();
    this.backdrop = undefined;
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected && this.available(opener)) opener.focus();
    else doc.getElementById("hud-tools-toggle")?.focus();
  }

  private focusable(): HTMLElement[] {
    return Array.from(
      this.root.querySelectorAll<HTMLElement>(
        'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) =>
        this.available(element) && element.getAttribute("type") !== "hidden",
    );
  }

  private available(element: HTMLElement): boolean {
    if (element.closest("[hidden],[inert]")) return false;
    for (
      let parent: HTMLElement | null = element;
      parent;
      parent = parent.parentElement
    ) {
      if (
        parent.tagName === "DETAILS" &&
        !(parent as HTMLDetailsElement).open &&
        parent.querySelector("summary") !== element
      )
        return false;
      const style = element.ownerDocument.defaultView?.getComputedStyle(parent);
      if (style?.display === "none" || style?.visibility === "hidden")
        return false;
    }
    return true;
  }
}
