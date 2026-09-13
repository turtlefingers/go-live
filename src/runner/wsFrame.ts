/**
 * 클라이언트 → 서버 WebSocket 프레임 해석 (텍스트, 종료, 핑만).
 * 브라우저가 보내는 프레임은 항상 마스킹돼 있다. 조각(fragment)은 지원하지 않는다.
 * vscode 모듈에 의존하지 않는다 (단위 테스트 대상).
 */

export interface DecodedFrames {
  messages: string[];
  close: boolean;
  ping: boolean;
  /** 아직 완성되지 않은 나머지 바이트 (다음 data 이벤트와 이어 붙인다) */
  rest: Buffer;
}

export function decodeFrames(buf: Buffer): DecodedFrames {
  const out: DecodedFrames = { messages: [], close: false, ping: false, rest: Buffer.alloc(0) };
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length < p + 2) {
        break;
      }
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length < p + 8) {
        break;
      }
      // 상위 32비트는 무시한다 (이 서버가 받는 메시지는 작다)
      len = buf.readUInt32BE(p + 4);
      p += 8;
    }
    const maskKey = masked ? buf.subarray(p, p + 4) : undefined;
    if (masked) {
      p += 4;
    }
    if (buf.length < p + len) {
      break; // 페이로드가 아직 다 안 옴
    }
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (maskKey) {
      for (let k = 0; k < payload.length; k++) {
        payload[k] ^= maskKey[k & 3];
      }
    }
    if (opcode === 0x1) {
      out.messages.push(payload.toString('utf8'));
    } else if (opcode === 0x8) {
      out.close = true;
    } else if (opcode === 0x9) {
      out.ping = true;
    }
    off = p + len;
  }
  out.rest = Buffer.from(buf.subarray(off));
  return out;
}

/** 테스트/클라이언트용: 마스킹된 텍스트 프레임을 만든다 */
export function encodeMaskedText(text: string, mask = Buffer.from([0x12, 0x34, 0x56, 0x78])): Buffer {
  const payload = Buffer.from(text, 'utf8');
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  } else {
    const h = Buffer.alloc(10);
    h[0] = 0x81;
    h[1] = 0x80 | 127;
    h.writeUInt32BE(0, 2);
    h.writeUInt32BE(payload.length, 6);
    header = h;
  }
  const masked = Buffer.from(payload);
  for (let k = 0; k < masked.length; k++) {
    masked[k] ^= mask[k & 3];
  }
  return Buffer.concat([header, mask, masked]);
}
