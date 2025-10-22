export class LoadingOverlay {
  private overlay: HTMLElement | null = null;

  show(message: string = 'Loading...'): void {
    if (this.overlay) {
      this.hide();
    }

    this.overlay = document.createElement('div');
    this.overlay.className = 'loading-overlay';
    this.overlay.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text">${message}</div>
    `;

    document.body.appendChild(this.overlay);
  }

  updateMessage(message: string): void {
    if (this.overlay) {
      const textElement = this.overlay.querySelector('.loading-text');
      if (textElement) {
        textElement.textContent = message;
      }
    }
  }

  hide(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
