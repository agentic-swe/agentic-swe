/**
 * Demo helper for the golden-path walkthrough (intentional bug).
 * @param {unknown[]} arr
 * @returns {number}
 */
export function countItems(arr) {
  // Bug: off-by-one — learners should return arr.length
  return arr.length - 1
}

export const APP_VERSION = '0.0.0-demo'
