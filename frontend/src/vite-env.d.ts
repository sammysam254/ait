/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'jmuxer' {
  export default class JMuxer {
    constructor(options: {
      node: HTMLVideoElement | string;
      mode?: 'video' | 'audio' | 'both';
      flushingTime?: number;
      clearBuffer?: boolean;
      fps?: number;
      debug?: boolean;
      onError?: (data: any) => void;
    });
    feed(data: { video?: Uint8Array; audio?: Uint8Array; duration?: number }): void;
    destroy(): void;
    reset(): void;
  }
}
