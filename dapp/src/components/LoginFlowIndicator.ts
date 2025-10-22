export class LoginFlowIndicator {
  private container: HTMLElement | null = null;
  private steps = [
    { id: 'connect', icon: '🔗', text: 'Connect Wallet' },
    { id: 'challenge', icon: '🎯', text: 'Get Challenge' },
    { id: 'sign', icon: '✍️', text: 'Sign Message' },
    { id: 'verify', icon: '✓', text: 'Verify & Login' }
  ];

  show(containerId: string): void {
    const parent = document.getElementById(containerId);
    if (!parent) return;

    this.container = document.createElement('div');
    this.container.className = 'login-flow-indicator';
    this.container.innerHTML = this.steps.map((step, index) => `
      <div class="login-step ${index === 0 ? 'active' : ''}" data-step="${index}">
        <div class="login-step-icon">${step.icon}</div>
        <div class="login-step-text">${step.text}</div>
      </div>
    `).join('');

    parent.appendChild(this.container);
  }

  setStep(stepIndex: number): void {
    if (!this.container) return;

    const stepElements = this.container.querySelectorAll('.login-step');
    
    stepElements.forEach((element, index) => {
      element.classList.remove('active', 'completed');
      if (index < stepIndex) {
        element.classList.add('completed');
      } else if (index === stepIndex) {
        element.classList.add('active');
      }
    });
  }

  complete(): void {
    if (!this.container) return;

    const stepElements = this.container.querySelectorAll('.login-step');
    stepElements.forEach(element => {
      element.classList.remove('active');
      element.classList.add('completed');
    });

    setTimeout(() => {
      this.hide();
    }, 2000);
  }

  hide(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}

