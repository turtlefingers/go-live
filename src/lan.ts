/**
 * 휴대폰으로 보기: 같은 네트워크의 IPv4 주소 찾기, 접속 가능 여부 확인, QR 코드.
 * vscode 모듈에 의존하지 않는다 (단위 테스트 대상).
 */
import * as os from 'os';
import * as net from 'net';
import qrcode from 'qrcode-generator';

/** 와이파이/유선 인터페이스의 IPv4 주소. 사설 대역을 우선하고, 가상 인터페이스(docker, vpn 류)는 뒤로 미룬다 */
export function lanAddress(interfaces = os.networkInterfaces()): string | undefined {
  const candidates: Array<{ name: string; address: string; score: number }> = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) {
        continue;
      }
      let score = 0;
      if (/^(192\.168\.|10\.)/.test(info.address)) {
        score += 2;
      } else if (/^172\.(1[6-9]|2\d|3[01])\./.test(info.address)) {
        score += 1;
      }
      if (/^(en0|wlan|wi-?fi|eth0|Ethernet)/i.test(name)) {
        score += 2;
      }
      if (/^(docker|br-|veth|utun|tun|tap|vmnet|vboxnet|bridge|llw|awdl)/i.test(name)) {
        score -= 5;
      }
      candidates.push({ name, address: info.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address;
}

/** TCP 연결이 되는지 (dev 서버가 그 주소에서 듣고 있는지) */
export function isReachable(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** URL 을 QR 코드 SVG 로. 휴대폰 카메라가 바로 읽는다 */
export function qrSvg(text: string, cellSize = 6): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize, margin: 2, scalable: true });
}

/** dev 서버를 다른 기기에서도 듣게 하는 인자 (도구별) */
export function lanArgs(scriptCommand: string): string[] {
  if (/\bnext\b/.test(scriptCommand)) {
    return ['-H', '0.0.0.0'];
  }
  return ['--host', '0.0.0.0'];
}
