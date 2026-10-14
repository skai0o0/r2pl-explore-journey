// client/src/ui/floatingText.ts
/**
 * Lightweight Floating Text Feedback System for World Interactions
 * Displays floating combat/resource text like "-1 Point", "+1 Ô Tri Thức", "+10 Tinh Thể"
 */

export type FloatingTextKind =
  | "cost"
  | "knowledge"
  | "crystal"
  | "key"
  | "gain"
  | "error";

export class FloatingTextManager {
  private static container: HTMLElement | null = null;

  private static ensureContainer(): HTMLElement {
    if (!FloatingTextManager.container || !document.body.contains(FloatingTextManager.container)) {
      FloatingTextManager.container = document.createElement("div");
      FloatingTextManager.container.id = "floating-text-container";
      FloatingTextManager.container.className = "floating-text-container";
      FloatingTextManager.container.setAttribute("data-ui", "true");
      document.body.appendChild(FloatingTextManager.container);
    }
    return FloatingTextManager.container;
  }

  public static spawn(
    screenX: number,
    screenY: number,
    text: string,
    kind: FloatingTextKind = "gain",
  ): void {
    const container = FloatingTextManager.ensureContainer();
    const el = document.createElement("div");
    el.className = `floating-text-bubble kind-${kind}`;
    el.textContent = text;

    // Slight random offset to prevent stacking when clicking rapidly
    const jitterX = (Math.random() - 0.5) * 16;
    el.style.left = `${screenX + jitterX}px`;
    el.style.top = `${screenY}px`;

    container.appendChild(el);

    // Remove element after CSS animation (1200ms) completes
    setTimeout(() => {
      el.remove();
    }, 1250);
  }
}
