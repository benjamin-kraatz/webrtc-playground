export interface SdpSession {
  version: string;
  origin: string;
  sessionName: string;
  timing: string;
  groups: string[];
  ice?: { ufrag?: string; pwd?: string; options?: string };
  fingerprint?: string;
  media: SdpMedia[];
  raw: string;
}

export interface SdpMedia {
  type: 'audio' | 'video' | 'application' | string;
  port: number;
  protocol: string;
  direction: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive' | '';
  mid?: string;
  ssrcs: SdpSsrc[];
  codecs: SdpCodec[];
  candidates: SdpCandidate[];
  ice?: { ufrag?: string; pwd?: string };
  rtcpFb: string[];
  extmap: SdpExtmap[];
  raw: string[];
}

export interface SdpSsrc {
  id: string;
  attribute: string;
  value?: string;
}

export interface SdpCodec {
  payloadType: number;
  name: string;
  clockRate?: number;
  channels?: number;
  fmtp?: string;
}

export interface SdpCandidate {
  foundation: string;
  component: string;
  protocol: string;
  priority: string;
  ip: string;
  port: string;
  type: 'host' | 'srflx' | 'relay' | string;
  raddr?: string;
  rport?: string;
}

export interface SdpExtmap {
  id: number;
  uri: string;
  direction?: string;
}

export function parseSdp(sdpStr: string): SdpSession {
  const lines = sdpStr.split(/\r?\n/).filter((l) => l.trim());
  const session: SdpSession = {
    version: '',
    origin: '',
    sessionName: '',
    timing: '',
    groups: [],
    media: [],
    raw: sdpStr,
  };

  let currentMedia: SdpMedia | null = null;
  const rtpmapMap = new Map<number, SdpCodec>();

  for (const line of lines) {
    const [field, ...rest] = line.split('=');
    const value = rest.join('=');

    if (currentMedia) {
      currentMedia.raw.push(line);
    }

    switch (field) {
      case 'v':
        if (!currentMedia) session.version = value;
        break;
      case 'o':
        if (!currentMedia) session.origin = value;
        break;
      case 's':
        if (!currentMedia) session.sessionName = value;
        break;
      case 't':
        if (!currentMedia) session.timing = value;
        break;
      case 'm': {
        if (currentMedia) {
          // finalize codecs from rtpmap
          rtpmapMap.forEach((codec) => {
            if (!currentMedia!.codecs.find((c) => c.payloadType === codec.payloadType)) {
              currentMedia!.codecs.push(codec);
            }
          });
          rtpmapMap.clear();
          session.media.push(currentMedia);
        }
        const parts = value.split(' ');
        currentMedia = {
          type: parts[0],
          port: parseInt(parts[1]),
          protocol: parts[2],
          direction: '',
          ssrcs: [],
          codecs: [],
          candidates: [],
          rtcpFb: [],
          extmap: [],
          raw: [line],
        };
        break;
      }
      case 'a': {
        const [attr, ...attrRest] = value.split(':');
        const attrValue = attrRest.join(':');
        if (currentMedia) {
          parseMediaAttribute(currentMedia, attr, attrValue, rtpmapMap);
        } else {
          parseSessionAttribute(session, attr, attrValue);
        }
        break;
      }
    }
  }

  if (currentMedia) {
    rtpmapMap.forEach((codec) => {
      if (!currentMedia!.codecs.find((c) => c.payloadType === codec.payloadType)) {
        currentMedia!.codecs.push(codec);
      }
    });
    session.media.push(currentMedia);
  }

  return session;
}

function parseSessionAttribute(session: SdpSession, attr: string, value: string): void {
  switch (attr) {
    case 'group':
      session.groups.push(value);
      break;
    case 'ice-ufrag':
      session.ice = { ...session.ice, ufrag: value };
      break;
    case 'ice-pwd':
      session.ice = { ...session.ice, pwd: value };
      break;
    case 'ice-options':
      session.ice = { ...session.ice, options: value };
      break;
    case 'fingerprint':
      session.fingerprint = value;
      break;
  }
}

function parseMediaAttribute(
  media: SdpMedia,
  attr: string,
  value: string,
  rtpmapMap: Map<number, SdpCodec>
): void {
  switch (attr) {
    case 'sendrecv':
    case 'sendonly':
    case 'recvonly':
    case 'inactive':
      media.direction = attr;
      break;
    case 'mid':
      media.mid = value;
      break;
    case 'rtpmap': {
      const [pt, rest] = value.split(' ');
      const [name, clockRate, channels] = rest?.split('/') ?? [];
      const codec: SdpCodec = {
        payloadType: parseInt(pt),
        name: name ?? '',
        clockRate: clockRate ? parseInt(clockRate) : undefined,
        channels: channels ? parseInt(channels) : undefined,
      };
      rtpmapMap.set(codec.payloadType, codec);
      break;
    }
    case 'fmtp': {
      const [pt, fmtpValue] = value.split(' ');
      const codec = rtpmapMap.get(parseInt(pt));
      if (codec) codec.fmtp = fmtpValue;
      break;
    }
    case 'ssrc': {
      const spaceIdx = value.indexOf(' ');
      const id = value.slice(0, spaceIdx);
      const rest = value.slice(spaceIdx + 1);
      const [ssrcAttr, ...ssrcValParts] = rest.split(':');
      media.ssrcs.push({ id, attribute: ssrcAttr, value: ssrcValParts.join(':') });
      break;
    }
    case 'candidate': {
      const parts = value.split(' ');
      const cand: SdpCandidate = {
        foundation: parts[0],
        component: parts[1],
        protocol: parts[2],
        priority: parts[3],
        ip: parts[4],
        port: parts[5],
        type: parts[7] as SdpCandidate['type'],
      };
      const raddrIdx = parts.indexOf('raddr');
      if (raddrIdx !== -1) cand.raddr = parts[raddrIdx + 1];
      const rportIdx = parts.indexOf('rport');
      if (rportIdx !== -1) cand.rport = parts[rportIdx + 1];
      media.candidates.push(cand);
      break;
    }
    case 'ice-ufrag':
      media.ice = { ...media.ice, ufrag: value };
      break;
    case 'ice-pwd':
      media.ice = { ...media.ice, pwd: value };
      break;
    case 'rtcp-fb':
      media.rtcpFb.push(value);
      break;
    case 'extmap': {
      const [idStr, uri] = value.split(' ');
      const [idNum, direction] = idStr.split('/');
      media.extmap.push({ id: parseInt(idNum), uri: uri ?? '', direction });
      break;
    }
  }
}
