/**
 * MAX text messages allow 4000 characters. Bot-composed text is kept below the
 * limit to leave room for the formatting markup that wraps it.
 */
export const DEFAULT_MAX_PART_CHARS = 3800;
export const DEFAULT_MAX_PART_BLOCKS = 480;

/** Budget for text that is delivered as a plain MAX message. */
export const PLAIN_MAX_PART_CHARS = 3800;

/** Hard MAX limit for `POST /messages` and `PUT /messages` text. */
export const MAX_TEXT_MESSAGE_LIMIT = 4000;
