/**
 * Utility for safely extracting error messages from unknown caught values.
 *
 * TypeScript's catch blocks receive `unknown` type, but many places in the codebase
 * use unsafe `(error as Error).message` assertions. This utility provides type-safe
 * error message extraction.
 */

/**
 * Safely extracts an error message from an unknown value.
 * Handles Error instances, strings, and objects with a message property.
 *
 * @param error - The caught error value (unknown type)
 * @returns A string message describing the error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return 'Unknown error occurred';
}

/**
 * Checks if an error's message contains a specific substring.
 * Safe alternative to `(error as Error).message.includes(...)`.
 *
 * @param error - The caught error value (unknown type)
 * @param substring - The substring to search for
 * @returns true if the error message contains the substring
 */
export function errorMessageIncludes(error: unknown, substring: string): boolean {
  const message = getErrorMessage(error);
  return message.includes(substring);
}
