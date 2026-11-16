import http from 'node:http';
import { EventEmitter } from 'node:events';
import type { Logging } from 'homebridge';

/**
 * 홈 서버의 상태 스트림(/events, Server-Sent Events)을 듣는다. (실험)
 *
 * 처음에 전체 상태를 받고 이후엔 바뀐 값만 받는다. 기기 클래스는 여기서 값을 읽고(조회 호출 없음),
 * 바뀔 때마다 홈킷에 밀어 준다. 스트림이 끊겨 있으면 fresh()가 false라서 기기 클래스가 예전처럼 직접 조회한다.
 */
export class StateStream extends EventEmitter {
  private readonly values = new Map<string, string>();
  private connected = false;
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
    const retry = () => {
      if (this.connected) {
        this.log.warn('[stream] 끊김. 3초 뒤 다시 연결');
      }
      this.connected = false;
      setTimeout(() => this.connect(), 3000);
    };
    const request = http.get(this.url, { headers: { Accept: 'text/event-stream' } }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        retry();
        return;
      }
      response.setEncoding('utf8');
      let buffer = '';
      response.on('data', (chunk: string) => {
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          this.handle(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
      });
      response.on('end', retry);
      response.on('error', () => undefined);
    });
    request.on('error', retry);
  }

  private handle(block: string) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) {
        event = line.slice(7);
      } else if (line.startsWith('data: ')) {
        data += line.slice(6);
      }
    }
    if (data === '') {
      return; // keep-alive
    }
    if (event === 'snapshot') {
      const all = JSON.parse(data) as Record<string, string>;
      for (const [key, value] of Object.entries(all)) {
        this.set(key, value);
      }
      this.connected = true;
      this.log.info(`[stream] 연결됨. 상태 ${this.values.size}개`);
      return;
    }
    const change = JSON.parse(data) as { key: string; value: string | null };
    if (change.value === null) {
      this.values.delete(change.key); // 만료돼 지워진 값(예: 엘리베이터 도착 표시)
      this.emit(`${change.key}:removed`);
      this.emit('change', change.key);
      return;
    }
    this.set(change.key, change.value);
  }

  private set(key: string, value: string) {
    if (this.values.get(key) === value) {
      return;
    }
    this.values.set(key, value);
    this.emit(key, value);
    this.emit('change', key);
  }
}
