export const developmentApiProxy = {
  target: 'http://127.0.0.1:3001',
  // Keep the browser's Host header so the local API can enforce same-origin.
  changeOrigin: false,
}
