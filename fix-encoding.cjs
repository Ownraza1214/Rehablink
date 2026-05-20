// Byte-level replacement script - uses hex patterns so no encoding issues
const fs = require('fs')
const path = require('path')

function getFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...getFiles(f))
    else if (/\.(jsx?|ts)$/.test(e.name)) out.push(f)
  }
  return out
}

function bufReplace(buf, fromHex, toStr) {
  const search = Buffer.from(fromHex, 'hex')
  const replace = Buffer.from(toStr, 'utf8')
  const parts = []
  let pos = 0
  while (pos < buf.length) {
    const idx = buf.indexOf(search, pos)
    if (idx === -1) { parts.push(buf.slice(pos)); break }
    parts.push(buf.slice(pos, idx))
    parts.push(replace)
    pos = idx + search.length
  }
  return parts.length ? Buffer.concat(parts) : buf
}

// [from_hex, to_ascii]
const REPLACEMENTS = [
  // Theta + subscript
  ['c38ec2b8c3a2e2809ae2809a', 'Theta2'],
  ['c38ec2b8c3a2e2809ac692',   'Theta3'],
  ['c38ec2b8c3a2e2809ae2809e', 'Theta4'],
  ['c38ec2b8c3a2e2809ac281',   'Theta1'],
  // Omega + subscript
  ['c38fe280b0c3a2e2809ac692',   'w3'],
  ['c38fe280b0c3a2e2809ae2809e', 'w4'],
  // Alpha + subscript
  ['c38ec2b1c3a2e2809ac692',   'a3'],
  ['c38ec2b1c3a2e2809ae2809e', 'a4'],
  // Psi + subscript
  ['c38fcb86c3a2e2809ac281',   'psi1'],
  ['c38fcb86c3a2e2809ae2809a', 'psi2'],
  ['c38fcb86c3a2e2809ac692',   'psi3'],
  // Phi + subscript
  ['c38fe280a0c3a2e2809ac281',   'phi1'],
  ['c38fe280a0c3a2e2809ae2809a', 'phi2'],
  ['c38fe280a0c3a2e2809ac692',   'phi3'],
  // Single Greek
  ['c38ec2b8', 'Theta'],
  ['c38fe280b0', 'w'],
  ['c38ec2b1', 'alpha'],
  ['c38ec2bc', 'mu'],
  ['c38fcb86', 'psi'],
  ['c38fe280a0', 'phi'],
  // L-subscript labels
  ['4cc3a2e2809ac281',   'L1'],
  ['4cc3a2e2809ae2809a', 'L2'],
  ['4cc3a2e2809ac692',   'L3'],
  ['4cc3a2e2809ae2809e', 'L4'],
  // O-subscript labels
  ['4fc3a2e2809ae2809a', 'O2'],
  ['4fc3a2e2809ae2809e', 'O4'],
  // V/A subscript
  ['56c3a2e2809ac281',   'Va'],
  ['41c3a2e2809ac281',   'Aa'],
  ['41c3a2e2809ae2809a', 'Ab'],
  // Instant-center labels
  ['49c3a2e2809ac281c3a2e2809ae2809a', 'I12'],
  ['49c3a2e2809ac281c3a2e2809ac692',   'I13'],
  ['49c3a2e2809ac281c3a2e2809ae2809e', 'I14'],
  ['49c3a2e2809ae2809ac3a2e2809ac692',   'I23'],
  ['49c3a2e2809ae2809ac3a2e2809ae2809e', 'I24'],
  ['49c3a2e2809ac692c3a2e2809ae2809e',   'I34'],
  // Bare subscripts
  ['c3a2e2809ac281',   '1'],
  ['c3a2e2809ae2809a', '2'],
  ['c3a2e2809ac692',   '3'],
  ['c3a2e2809ae2809e', '4'],
  // Common punctuation
  ['c382c2b0',           'deg'],
  ['c382c2b7',           '.'],
  ['c3a2e282ace2809d',   ' - '],
  ['c3a2e282ace2809c',   ' - '],
  ['c3a2e282acc2ba',     ' > '],
  ['c3a2e280a0e28099',   '->'],
  ['c3a2e280b0c2a5',     '>='],
  ['c3a2e280b0c2a4',     '<='],
  ['c2b1',               '+/-'],
  // Sidebar / UI icons
  ['c3a2c592e2809a',     '@'],
  ['c3a2e284a2c2a5',     '+'],
  ['c3a2c5a1e284a2',     '*'],
  ['c3a2e28094cb86',     '#'],
  ['c3a2e280a1e282ac',   '~'],
  ['c3a2c593c2a6',       '*'],
  ['c3a2e28094e280b0',   'o'],
  ['c3a2c593e2809d',     'v'],
  ['c3a2c593e28094',     'x'],
  ['c3a2c5a0e280a2',     '+'],
  ['c3a2e28093c2b6',     '>'],
  ['c3a2c2ace280a1',     'v'],
  ['c3a2c5b8c2b3',       '...'],
  ['c3a2cb9ce280a6',     '*'],
  ['c3a2c593e2809c',     'v'],
  // Curly quotes to straight
  ['e28098', "'"],
  ['e28099', "'"],
  ['e2809c', '"'],
  ['e2809d', '"'],
]

const files = getFiles(path.join(__dirname, 'src'))
let changed = 0

for (const file of files) {
  let buf = fs.readFileSync(file)
  const orig = buf.toString('hex')
  for (const [fromHex, toStr] of REPLACEMENTS) {
    buf = bufReplace(buf, fromHex, toStr)
  }
  if (buf.toString('hex') !== orig) {
    fs.writeFileSync(file, buf)
    console.log('Fixed:', path.relative(__dirname, file))
    changed++
  }
}
console.log(`\nDone. ${changed} file(s) updated.`)
