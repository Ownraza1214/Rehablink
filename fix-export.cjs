const fs = require('fs')

function replace(buf, fromHex, toStr) {
  const search = Buffer.from(fromHex, 'hex')
  const rep = Buffer.from(toStr, 'utf8')
  const parts = []
  let pos = 0
  while (pos < buf.length) {
    const idx = buf.indexOf(search, pos)
    if (idx === -1) { parts.push(buf.slice(pos)); break }
    parts.push(buf.slice(pos, idx))
    parts.push(rep)
    pos = idx + search.length
  }
  return Buffer.concat(parts)
}

const file = __dirname + '/src/pages/ExportFabrication.jsx'
let buf = fs.readFileSync(file)

// PDF emoji: c3b0c5b8 22 c290 22  =>  [PDF]"   (the 22 quotes are part of the broken encoding)
buf = replace(buf, 'c3b0c5b822c29022', '[PDF]"')

// CAD emoji (same pattern but for 📐 or similar - offset ~10200, also look for c3b0c5b8 variants)
// The CAD icon was "ðŸ"" which may be same or different
// Let's just scan for any remaining c3b0c5b8
buf = replace(buf, 'c3b0c5b822c29022', '[CAD]"')

// Checklist bullet: c3a2cb9cc290  =>  *
buf = replace(buf, 'c3a2cb9cc290', '*')

fs.writeFileSync(file, buf)
console.log('Done')

// Verify no more non-ASCII (except BOM)
const out = fs.readFileSync(file)
let i = 0, issues = 0
while (i < out.length) {
  if (out[i] > 127 && i > 3) {
    let seq = ''
    let start = i
    while (i < out.length && out[i] > 127) {
      seq += out[i].toString(16).padStart(2, '0')
      i++
    }
    const ctx = out.slice(Math.max(0, start - 15), start + 20).toString('latin1')
    console.log('REMAINING offset', start, 'hex:', seq, '| ctx:', JSON.stringify(ctx))
    issues++
  } else {
    i++
  }
}
if (!issues) console.log('No non-ASCII remaining (clean)')
