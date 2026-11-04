/** Management syntax and resume-last must reach dispatch, not picker activation. */
export function sessionPickerQuery(value: string): string | undefined {
  const match = /^\/(sessions|resume)\s+([\s\S]*)$/i.exec(value)
  if (!match) return undefined
  const query = match[2].trim()
  if (match[1].toLowerCase() === 'sessions' && /^(rename|favorite|archive|all|archived)(?:\s|$)/i.test(query)) return undefined
  if (match[1].toLowerCase() === 'resume' && query === 'last') return undefined
  return query.toLocaleLowerCase()
}
