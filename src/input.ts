// Keyboard and mouse state.
export class Input {
  keys = new Set<string>();
  pressed: string[] = [];
  mouseX = 0;
  mouseY = 0;
  /** Normalised device coordinates. */
  ndcX = 0;
  ndcY = 0;
  lmb = false;
  rmb = false;
  lmbPressed = false;
  lmbReleased = false;
  rmbPressed = false;
  wheel = 0;
  /** Set when the pointer is over UI so clicks don't leak into the world. */
  overUi = false;
  enabled = true;
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const k = e.code;
      if (!this.keys.has(k)) this.pressed.push(k);
      this.keys.add(k);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'F1'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.lmb = false;
      this.rmb = false;
    });
    el.addEventListener('mousemove', (e) => this.move(e));
    window.addEventListener('mousemove', (e) => this.move(e));
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.lmb = true;
        this.lmbPressed = true;
      } else if (e.button === 2) {
        this.rmb = true;
        this.rmbPressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        if (this.lmb) this.lmbReleased = true;
        this.lmb = false;
      } else if (e.button === 2) this.rmb = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  private move(e: MouseEvent): void {
    const r = this.el.getBoundingClientRect();
    this.mouseX = e.clientX - r.left;
    this.mouseY = e.clientY - r.top;
    this.ndcX = (this.mouseX / r.width) * 2 - 1;
    this.ndcY = -(this.mouseY / r.height) * 2 + 1;
  }

  down(code: string): boolean {
    return this.enabled && this.keys.has(code);
  }

  /** Consume a key press. */
  hit(code: string): boolean {
    if (!this.enabled) return false;
    const i = this.pressed.indexOf(code);
    if (i >= 0) {
      this.pressed.splice(i, 1);
      return true;
    }
    return false;
  }

  endFrame(): void {
    this.pressed.length = 0;
    this.lmbPressed = false;
    this.lmbReleased = false;
    this.rmbPressed = false;
    this.wheel = 0;
  }
}
