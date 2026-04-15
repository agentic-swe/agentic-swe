import assert from 'node:assert/strict'
import { countItems, APP_VERSION } from '../src/counter.js'

assert.equal(typeof APP_VERSION, 'string')
assert.equal(countItems([1, 2, 3]), 3, 'countItems should return array length')
