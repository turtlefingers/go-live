/**
 * npm 흐름 스모크 테스트용 최소 vscode 스텁.
 * NpmSession / ProcessTerminal 이 쓰는 EventEmitter 만 구현한다.
 */
export class EventEmitter<T> {
  private listeners = new Set<(e: T) => void>();
  readonly event = (listener: (e: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(e: T): void {
    for (const l of [...this.listeners]) {
      l(e);
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}
