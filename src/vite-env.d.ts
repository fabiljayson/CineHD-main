/// <reference types="vite/client" />

declare module '*.woff2?url' {
    const src: string;
    export default src;
}

export {};

declare module 'react' {
  interface HTMLAttributes<T> {
    inert?: boolean | '';
  }
}

declare module 'canvas-confetti' {
  const confetti: any;
  export default confetti;
  module.exports = confetti;
}

declare module 'qrcode' {
  const QRCode: any;
  export = QRCode;
  export default QRCode;
}
