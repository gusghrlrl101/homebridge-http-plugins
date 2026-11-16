import http from 'node:http';
import { EventEmitter } from 'node:events';
import type { Logging } from 'homebridge';

/**
 * 홈 서버의 상태 스트림(/events, Server-Sent Events)을 듣는다. (실험)
 *
 * 처음에 전체 상태를 받고 이후엔 바뀐 값만 받는다. 기기 클래스는 여기서 값을 읽고(조회 호출 없음),
 * 바뀔 때마다 홈킷에 밀어 준다. 스트림이 끊겨 있으면 fresh()가 false라서 기기 클래스가 예전처럼 직접 조회한다.
 *
 * 내는 이벤트: `<키>`(값), `<키>:removed`, 'change'(키) — 어떤 키든 바뀌거나 지워지면.
 */
export class StateStream extends EventEmitter {
  static readonly RETRY_MS = 3000;
  // 서버는 15초마다 keep-alive를 보낸다. 이만큼 아무것도 안 오면 죽은 연결로 보고 다시 붙는다.
  static readonly WATCHDOG_MS = 45_000;

  private readonly values = new Map<string, string>();
  private connected = false;
  private warned = false; // 연결 못 함 경고는 한 번만
  private static shared: StateStream | null = null;

  static get(log: Logging, url: string): StateStream {
    if (StateStream.shared === null) {
      StateStream.shared = new StateStream(log, url);
    }
    return StateStream.shared;
  }

  private constructor(private readonly log: Logging, private readonly url: string) {
    super();
    this.setMaxListeners(100);
    this.connect();
  }

  fresh(): boolean {
    return this.connected;
  }

  value(key: string): string | undefined {
    return this.values.get(key);
  }

  private connect() {
    let done = false; // 이 연결에 대해 재시도는 한 번만 건다(end/close/error/timeout이 겹쳐 와도)
    let request: http.ClientRequest | null = null;
    const retry = (why: string) => {
      if (done) {
        return;
      }
      done = true;
      request?.destroy();
      if (this.connected) {
        this.log.warn(`[stream] 끊김(${why}). 3초 뒤 다시 연결. 그동안은 직접 조회`);
      } else if (!this.warned) {
        this.warned = true;
        this.log.warn(`[stream] 연결하지 못함(${why}). 3초마다 다시 시도. 그동안은 직접 조회`);
      }
      this.connected = false;
      setTimeout(() => this.connect(), StateStream.RETRY_MS);
    };
    request = http.get(this.url, { headers: { Accept: 'text/event-stream' } }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        retry(`HTTP ${response.statusCode}`);
        return;
      }
      response.setEncoding('utf8');
      let buffer = '';
      response.on('data', (chunk: string) => {
        buffer = (buffer + chunk).replace(/\r\n/g, '\n');
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          try {
            this.handle(block);
          } catch (error) { // 여기서 예외가 밖으로 나가면 브리지 전체가 내려간다
            this.log.warn(`[stream] 해석할 수 없는 메시지: ${error}`);
            retry('잘못된 메시지');
            return;
          }
        }
      });
      // 서버가 죽으면 'end' 없이 'close'만 올 수 있다(재시작, 크래시). 'close'는 어느 경우에나 온다.
      response.on('close', () => retry('서버가 연결을 닫음'));
      response.on('error', () => undefined);
    });
    request.setTimeout(StateStream.WATCHDOG_MS, () => retry('응답 없음'));
    request.on('error', error => retry(error.message));
  }

  private handle(block: string) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += line.slice(5).replace(/^ /, '');
      }
    }
    if (data === '') {
      return; // keep-alive
    }
    if (event === 'snapshot') {
      const all = JSON.parse(data) as Record<string, string>;
      for (const key of [...this.values.keys()]) {
        if (!(key in all)) {
          this.remove(key); // 끊겨 있던 사이 없어진 값(만료, 서버 재시작)
        }
      }
      for (const [key, value] of Object.entries(all)) {
        this.set(key, value);
      }
      this.connected = true;
      this.warned = false;
      this.log.info(`[stream] 연결됨. 상태 ${this.values.size}개`);
      return;
    }
    const change = JSON.parse(data) as { key: string; value: string | null };
    if (change.value === null) {
      this.remove(change.key); // 만료돼 지워진 값(예: 엘리베이터 도착 표시)
    } else {
      this.set(change.key, change.value);
    }
  }

  private set(key: string, value: string) {
    if (this.values.get(key) === value) {
      return;
    }
    this.values.set(key, value);
    this.notify(key, value);
    this.notify('change', key);
  }

  private remove(key: string) {
    if (!this.values.delete(key)) {
      return;
    }
    this.notify(`${key}:removed`);
    this.notify('change', key);
  }

  // 듣는 쪽 하나가 예외를 내도 나머지와 스트림은 계속 돈다
  private notify(event: string, ...args: unknown[]) {
    for (const listener of this.listeners(event)) {
      try {
        listener.apply(this, args);
      } catch (error) {
        this.log.warn(`[stream] ${event} 처리 중 오류: ${error}`);
      }
    }
  }
}
