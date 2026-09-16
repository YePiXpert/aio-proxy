import { once } from 'node:events';
import { connect, createServer, type Socket } from 'node:net';

export async function socksFixture(auth?: { username: string; password: string }, listenHost = '127.0.0.1') {
  const destinations: string[] = [];
  const sockets = new Set<Socket>();
  function track(socket: Socket) {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    return socket;
  }
  async function read(socket: Socket, length: number): Promise<Buffer> {
    for (;;) {
      const chunk = socket.read(length) as Buffer | null;
      if (chunk !== null) return chunk;
      await once(socket, 'readable');
    }
  }
  const server = createServer((socket) => {
    track(socket);
    void (async () => {
      const greeting = await read(socket, 2);
      await read(socket, greeting[1]!);
      socket.write(Buffer.from([5, auth ? 2 : 0]));
      if (auth) {
        const header = await read(socket, 2);
        const username = (await read(socket, header[1]!)).toString();
        const passwordLength = (await read(socket, 1))[0]!;
        const password = (await read(socket, passwordLength)).toString();
        const ok = username === auth.username && password === auth.password;
        socket.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) {
          socket.end();
          return;
        }
      }
      const request = await read(socket, 4);
      let host: string;
      if (request[3] === 3) {
        host = (await read(socket, (await read(socket, 1))[0]!)).toString();
      } else if (request[3] === 1) {
        host = [...(await read(socket, 4))].join('.');
      } else {
        throw new Error('Unexpected address type');
      }
      destinations.push(host);
      const port = (await read(socket, 2)).readUInt16BE();
      const upstream = track(connect(port, '127.0.0.1'));
      await once(upstream, 'connect');
      socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
      socket.pipe(upstream).pipe(socket);
      socket.on('close', () => upstream.destroy());
      upstream.on('close', () => socket.destroy());
    })().catch(() => socket.destroy());
  });
  server.listen(0, listenHost);
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing address');
  return {
    port: address.port,
    destinations,
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

// Self-signed certificate used only by the local TLS fixture.
export const tlsFixture = {
  key: `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDBiHau+z2ZVauY
fX4BxEHSSxFg4Pv/26UkJeJztrnw/Q2psuOnUGWWMFpuwnCb2jjgemJ+8BW4FRQt
oaLZh4CJi7CyNSia1LWnFnLTwut+hGBOTyy9Lo1RcPWZ0Visf+sST6hUVFYtmZg/
VkN0WezzvRVk0xKgCKV7spGt+Jkd9Kz+2HSgwGgNTka7i8KnJxsiTAxgpr/wRuYI
HoNu4XVpeMBno43ZN6VIXfh0h66WOIh5D9aA1S2pI8gjb9jPgErqPDpOmxumK0ln
e2No4uVUoFHGLfQLpqL+n4TGwp5v5RI+k2vIRs/6kvgqguVUD0Zqfx+ekx/E5T0P
KsO/4DDdAgMBAAECggEANKv7xSbavnsq/w8Uds2frmjA25GP9DQmz15CMgUGuThd
+hQWUmiWpVgWnLNtq3UqaqnUWcDk4FtYSQ0HQdXXnVe36OB/4xfGMqnw6YJQznef
sGBrCDf9vS8VoN3xmM0dwLeOVBk59SIq5f4H0MhSrYmGI5Ewrf58b1yLuoIAxj5i
kKGum5rpwgpCVtxZr8Ye9tKyHmaqUN89hL6fx0/ZeEmGy/lzhQ+vkeZC69ZCQyTw
47zl+G/0LBzyg8lv7WXzNeQOQjnQVgUHfTDxELZClIpW0zhmMpGwLrow9u5MT3Bg
/K3bqtEkIJ4Dil2+T+x4FYgGnfUm030ZyD1NE/ZfXwKBgQDjgm0eAkL24EB2cINy
UgQYlrRy6qXn/PanLRZfBDzmMgGAX58uqCSkSVwTqMPtyiYC+nP/QZALvSUiISOk
+XKo2h7JVuDVcopzyxTdJSiPOZEZbpD8oaciNLuRFiGrmNjw8ZOsDl+/PGP8lXWI
lu6Vtdp/NaX+jEYNuIsjXMrStwKBgQDZxM9qYOVDdrJlg+i5Gs2sVlWoRXzKF6zJ
Ej6CcPpGuEJELeAq4izSg5eFprX6+g4dXwHkVPcPXO0mnKzBqA4RungiFsdG22tO
ad2ykZ1eXlTJ/dHzQmpN5UM8a4KRYBcju5LX+sPEGKrbkgxl6F42aD4eRnC5gAqW
sZT3FID1CwKBgQCazLPSJ1fJAuzZqdTGhGelE2XUizQ3lTd+qH8AR7HoLz42StnU
tTO5VPEBr2Mg+NrETAWBOOr6EciiYEoQhmot2bv44tQ4Z6ctApE/p3jhexnvY/vi
6Vr/O0IkhhqC141E5BrGh0E+raiaxFckiQ3tb78rryUy/d7slxSVCx42IQKBgQDA
WxEflSFN+y3Pb7oEr4FXJheZgG+fD1SHc38Vt3fLOf0GvkMRfiE7fhM8ciqy22fW
V9KS/t4QivPLtH8AvFJZJI3zBo3VsAFUDT1P+0G3VrmshnCKYHMIBWfjmc+GXAt0
e75U2uNLdsKNGq+q4Js/kcq08WGm6UvxGkFMEqdqSwKBgQC/TqnZ7vp0RnVIIOpP
WxdjL4to+lfvJ9U6FCcuPSB7tW3Hd/mpv4RvVIWOmme4udhxoMiSxS7nxvJ92rAC
Bi1QWWV1Bvz7M3BmSDt57kK3GpDtgEpvL4tllfnC92e5GegCiH4IYircc4K0VMKr
kCEKVvwHk8InUBfJd172j4UtcA==
-----END PRIVATE KEY-----
`,
  cert: `-----BEGIN CERTIFICATE-----
MIIDNDCCAhygAwIBAgIUD9BuqoABIGABKSZBPfO4Vlk2A1UwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQdXBzdHJlYW0uaW52YWxpZDAeFw0yNjA5MTYwNTA5MTBa
Fw0zNjA5MTMwNTA5MTBaMBsxGTAXBgNVBAMMEHVwc3RyZWFtLmludmFsaWQwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDBiHau+z2ZVauYfX4BxEHSSxFg
4Pv/26UkJeJztrnw/Q2psuOnUGWWMFpuwnCb2jjgemJ+8BW4FRQtoaLZh4CJi7Cy
NSia1LWnFnLTwut+hGBOTyy9Lo1RcPWZ0Visf+sST6hUVFYtmZg/VkN0WezzvRVk
0xKgCKV7spGt+Jkd9Kz+2HSgwGgNTka7i8KnJxsiTAxgpr/wRuYIHoNu4XVpeMBn
o43ZN6VIXfh0h66WOIh5D9aA1S2pI8gjb9jPgErqPDpOmxumK0lne2No4uVUoFHG
LfQLpqL+n4TGwp5v5RI+k2vIRs/6kvgqguVUD0Zqfx+ekx/E5T0PKsO/4DDdAgMB
AAGjcDBuMB0GA1UdDgQWBBQufaDZDnrnf5GbVAKlbqAucywWYDAfBgNVHSMEGDAW
gBQufaDZDnrnf5GbVAKlbqAucywWYDAPBgNVHRMBAf8EBTADAQH/MBsGA1UdEQQU
MBKCEHVwc3RyZWFtLmludmFsaWQwDQYJKoZIhvcNAQELBQADggEBAB/zitBofjUT
YhibzIE7p66I/Zi8e/qnVy7Y2efi8xpzffO6Yjt31otzFOqFsG3B1kJXQUKmyuxu
kOUFdNygbmM702zBAXQg/XcQw5ylZnKwxpoJGs0t+7wFwvT08TJlSk/R7qjSMkt6
WTdnbONnP7WX1v5gC0hyitYaWmSUg3CWRI9dTVgQFfWNkri7kkG0iwv/fcwTOwtu
APKKUTD5UyZOCtKDicvgaQbmu0yHLYKhdajmvDNTjyPA2ocYEeyJ/qrl8AEOOYJ5
M1+yjpE0OJgqdoyFX8koIVUGZPbpWBTP0XqcKle+9VtA3Aiy20tF6rcdlEZKC50J
ezNCDfaHSI8=
-----END CERTIFICATE-----
`,
};
