/**
 * @inspector-hook/core
 * Core business logic for Inspector Hook
 */

// Re-export protocol types for convenience
export * from "@inspector-hook/protocol";
// Export main core class
export { InspectorCore } from "./core.js";
export { IpcServer } from "./ipc/ipc-server.js";
export { FileTracker } from "./managers/file-tracker.js";
export { LogManager } from "./managers/log-manager.js";
export { SessionManager } from "./managers/session-manager.js";
// Export core components
export { HttpServer } from "./server/http-server.js";

// Export version
export const VERSION = "0.1.0";
