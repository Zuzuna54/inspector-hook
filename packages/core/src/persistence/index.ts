/**
 * Persistence Layer
 * Exports persistence store and related utilities
 */

export { PersistenceStore, type PersistenceStoreOptions } from "./store.js";
export {
	migrateStore,
	CURRENT_SCHEMA_VERSION,
	type MigrationResult,
} from "./migrations.js";
