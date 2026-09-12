/**
 * `import.meta.env.BASE_URL` is `/dsh-tui` with no trailing slash under the
 * default `trailingSlash: 'ignore'`, so string-concatenating it produces
 * `/dsh-tuifavicon.svg`. Every internal link goes through here instead.
 */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
}
