// The product name, for every file we write beside a user's file.
//
// It used to be spelled into four separate template literals in writer.js.
// The rename missed all four, so each save dropped a backup named after the
// project this one used to be, and the project reader — which lists anything
// it does not recognise — reported that backup back to the user as an
// unidentified artifact. One constant here means the next rename is one edit,
// and the reader recognises what the writer produces by construction.
export const NAME = 'claudesight'

// Names earlier releases wrote. Recognised so their backups keep being pruned
// and are never listed as mystery artifacts. Never written.
const FORMER = ['atlas']
const ALL = [NAME, ...FORMER]

export const backupName = (target, stamp) => `${target}.${NAME}-${stamp}.bak`
export const lockName = (target) => `${target}.${NAME}-lock`
export const tempName = (pid, at) => `.${NAME}-tmp-${pid}-${at}`

// A backup of THIS file, under any name we have ever used.
export function isBackupOf(name, base) {
  return name.endsWith('.bak') && ALL.some((n) => name.startsWith(`${base}.${n}-`))
}

// Anything this app left behind, for any file. Used to keep our own leavings
// out of the list of things the user put there deliberately.
export function isOurs(name) {
  return ALL.some((n) =>
    name.endsWith(`.${n}-lock`)
    || name.startsWith(`.${n}-tmp-`)
    || (name.endsWith('.bak') && name.includes(`.${n}-`)))
}
