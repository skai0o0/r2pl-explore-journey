/** Selection never opens this surface implicitly. Onboarding comes from the private wallet projection. */
export class SelectedTilePanel {
  private novice = false;
  private explicit = false;
  private readonly panel: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly close: HTMLButtonElement;

  constructor(document: Document) {
    this.panel = document.getElementById("selected-tile-panel")!;
    this.toggle = document.getElementById(
      "tile-panel-toggle",
    ) as HTMLButtonElement;
    this.close = document.getElementById("tile-close") as HTMLButtonElement;
    this.toggle.addEventListener("click", () => this.open());
    this.close.addEventListener("click", () => {
      this.explicit = false;
      this.render();
      this.toggle.focus();
    });
    this.render();
  }

  open(): void {
    if (this.panel.hidden) this.explicit = true;
    this.render();
  }

  reset(): void {
    this.novice = false;
    this.explicit = false;
    this.render();
  }

  updateProfile(hasSpentPoints: boolean): void {
    this.novice = !hasSpentPoints;
    this.render();
  }

  private render(): void {
    this.panel.hidden = !this.novice && !this.explicit;
    this.toggle.hidden = !this.panel.hidden;
    this.toggle.setAttribute("aria-expanded", String(!this.panel.hidden));
    this.close.hidden = this.novice;
    this.panel.dataset.novice = String(this.novice);
  }
}
