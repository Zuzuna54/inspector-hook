// Paste this in VS Code's webview DevTools console to debug
// Open DevTools: Help > Toggle Developer Tools > then click into webview iframe

console.log('=== Inspector Hook Webview Debug ===');
console.log('State.connected:', State?.connected);
console.log('State.logs:', State?.logs?.length);
console.log('State.sessions:', State?.sessions?.length);
console.log('State.fileChanges:', State?.fileChanges?.length);
console.log('State.stats:', JSON.stringify(State?.stats, null, 2));

// Force request logs
if (typeof API !== 'undefined') {
  console.log('Forcing data fetch...');
  API.getLogs();
  API.getSessions();
  API.getFileChanges();
  setTimeout(() => {
    console.log('After fetch - logs:', State?.logs?.length);
  }, 1000);
} else {
  console.log('API not available!');
}
