import { createViewingActivityEmitter } from './viewing-activity';
import { watchTowerLink } from './wt-link';

/** The one emitter the server uses. Call `viewingActivity.emit(...)` when someone starts watching. */
export const viewingActivity = createViewingActivityEmitter({ link: watchTowerLink });
