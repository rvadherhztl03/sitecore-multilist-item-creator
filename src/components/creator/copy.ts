// Everything the creator and setup views say, in one place. Messages from the library (ConfigResult.message, SdkError.message) are shown as they come.

export const NOT_SET_UP = "This field isn't set up yet.";
export const OPEN_SETUP = 'Open setup';
export const NOT_FOUND = "Couldn't find this field's item on the page. Components from partial designs aren't supported yet.";
export const PICK = 'This field is on more than one component here. Which one?';
export const UNKNOWN_ERROR = 'Something went wrong.';
/** The message to show for anything a call threw (an SdkError says what happened in plain English). */
export const messageOf = (e: unknown) => (e instanceof Error && e.message) || UNKNOWN_ERROR;

export const partialFailure = (path: string, targetField: string) => `Created ${path}, but couldn't add it to ${targetField}. Select it there yourself.`;
export const added = (name: string, targetField: string) => `Added ${name} to ${targetField}.`;
export const RELOAD_HINT = ' Reload the page to see it in the list.';
export const creatingIn = (folderPath: string) => `New items are created in ${folderPath}.`;

export const TEMPLATE = 'Template';
export const CHOOSE_TEMPLATE = 'Choose a template';
export const NAME = 'Name';
export const CREATE = 'Create';
export const CREATING = 'Creating…';
export const CLOSE = 'Close';
export const BACK = 'Back';

// Setup
export const SETUP_TITLE = 'Setup';
export const SETUP_INTRO = 'Build the setup for this field, check it against this page, then copy it. Nothing is saved to Sitecore.';
export const TARGET_FIELD = 'Multilist field to add to';
export const FOLDER = 'Folder ID (optional)';
export const TEMPLATES = 'Template IDs, one per line (optional)';
export const NAME_FROM = 'Name from field (optional)';
export const REQUIRED = 'Required fields, one per line (optional)';
export const CHECK = 'Check';
export const CHECKING = 'Checking…';
export const COPY = 'Copy setup';
export const PASTE_HINT = "Paste this into the field's value on the template's Standard Values.";
export const COPIED = 'Copied the setup.';
export const COPY_FAILED = "Couldn't copy to the clipboard. Copy the setup below by hand.";
export const SETUP_JSON = 'Setup JSON';

export const noField = (targetField: string) => `No item on this page has a field named ${targetField}.`;
export const checked = (name: string, path: string) => `Checked ${name} (${path}).`;
export const folderLine = (path: string) => `Folder: ${path}`;
export const templatesLine = (names: string[]) => `Templates: ${names.join(', ')}`;
