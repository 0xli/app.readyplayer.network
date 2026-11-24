// The one place that knows where the API and beagle-embed assets live.
//
// This file ships to a PUBLIC repo, so it says only what a visitor's browser
// would learn anyway: the production API's hostname, the local dev address,
// and the static asset URLs loaded lazily when the embedded chat panel opens.
const IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

window.RP = {
  api: IS_LOCAL ? "http://127.0.0.1:3050" : "https://api.readyplayer.network",
  siteOrigin: IS_LOCAL ? "http://localhost:5174" : "https://readyplayer.network",
  bridgeUrl: "wss://bridge.beagle.chat/relay-ws,wss://im.beagle.chat/relay-ws",
  embedAssets: {
    react: "https://app.beagle.chat/vendor/react.production.min.js",
    reactDom: "https://app.beagle.chat/vendor/react-dom.production.min.js",
    qrcode: "https://app.beagle.chat/vendor/qrcode.js",
    peerWebrtc: "./assets/vendor/peer-webrtc.js?v=20261124",
    chatComponents: "https://app.beagle.chat/vendor/chat-components.js",
    beagleWeb: "https://app.beagle.chat/beagle-web.js",
    beagleUi: "./assets/vendor/beagle-ui.js?v=20261124",
  },
};
