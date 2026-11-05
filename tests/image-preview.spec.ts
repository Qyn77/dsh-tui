import { expect, it } from 'vitest'
import { imagePreviewCommand, openImagePreview } from '../src/terminal/image-preview.ts'

it('opens only supported local image paths without shell interpolation', () => {
  expect(imagePreviewCommand('darwin', true, '/tmp/a $(touch bad).png')).toEqual({
    file: '/usr/bin/open', args: ['-a', 'Preview', '--', '/tmp/a $(touch bad).png'],
  })
  expect(imagePreviewCommand('darwin', false, '/tmp/a.png')).toBeUndefined()
  expect(imagePreviewCommand('linux', true, 'https://example.com/a.png')).toBeUndefined()
  expect(imagePreviewCommand('darwin', true, '/tmp/a.command')).toBeUndefined()
  expect(imagePreviewCommand('win32', true, 'C:\\a.png')).toBeUndefined()
})
it('reports a missing image without spawning a viewer', async () => {
  expect(await openImagePreview('darwin', true, '/no-such-directory/dsh-test.png')).toBe('missing')
})
